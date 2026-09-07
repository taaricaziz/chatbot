import "server-only";
import { stripMarkdown } from "@/lib/text";

/**
 * CafeBot as the brain behind the site's chat widget.
 *
 * CafeBot is the original assistant in this repository (backend/), deployed
 * separately. Rather than embed its UI, the site's own widget keeps its
 * design and asks CafeBot for the words — so the customer sees one
 * consistent product and the operator can switch brains with an env var.
 *
 * Contract, from backend/server.js:
 *   POST /api/chat  { message, history?, sessionId? }
 *   -> 200 { reply, sessionId, order }     | 400 { error } | 502 { error }
 *
 * `sessionId` is accepted verbatim, which is why the widget's conversationId
 * can be CafeBot's session key: the same value groups the quota, the
 * transcript and CafeBot's cart.
 *
 * What CafeBot does NOT do is stream, so the widget shows "Thinking" for the
 * whole turn. Changing that means changing CafeBot, which is frozen.
 */

export class CafeBotError extends Error {
  constructor(
    message: string,
    /** True when waiting and retrying would plausibly succeed. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface CafeBotTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CafeBotReply {
  reply: string;
  sessionId: string;
  /** CafeBot's own order state, when it reports one. */
  orderStatus?: string;
  /** Set once CafeBot has saved a confirmed order, e.g. "CB-3F9A1C". */
  orderId?: string;
}

/** Base URL with no trailing slash, or null when CafeBot is not configured. */
export function cafeBotUrl(): string | null {
  const raw = process.env.CAFEBOT_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function cafeBotConfigured(): boolean {
  return cafeBotUrl() !== null;
}

/** Long enough for a tool-using turn, short enough that a hung call is not a hung page. */
const TIMEOUT_MS = 25_000;

export async function askCafeBot(input: {
  message: string;
  history: CafeBotTurn[];
  sessionId: string;
  /** Overridable for tests; defaults to CAFEBOT_URL. */
  baseUrl?: string;
}): Promise<CafeBotReply> {
  const base = input.baseUrl ?? cafeBotUrl();
  if (!base) {
    throw new CafeBotError("CAFEBOT_URL is not set.", false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        history: input.history,
        sessionId: input.sessionId,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    // Network failure or our own timeout: both are worth a retry.
    const detail = error instanceof Error ? error.message : "unknown";
    throw new CafeBotError(`CafeBot unreachable: ${detail}`, true);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    // 502 is CafeBot saying its own model call failed — transient. Anything
    // else is a contract problem and retrying will not help.
    throw new CafeBotError(
      `CafeBot returned ${response.status}: ${detail}`,
      response.status === 502 || response.status === 503 || response.status === 429,
    );
  }

  const body = (await response.json().catch(() => null)) as {
    reply?: unknown;
    sessionId?: unknown;
    order?: { status?: unknown; orderId?: unknown } | null;
  } | null;

  if (!body || typeof body.reply !== "string") {
    throw new CafeBotError("CafeBot returned no reply.", false);
  }

  const order = body.order ?? undefined;

  return {
    // CafeBot writes markdown. The widget renders plain text, and the
    // transcript must hold the same words the customer saw.
    reply: stripMarkdown(body.reply).trim(),
    sessionId: typeof body.sessionId === "string" ? body.sessionId : input.sessionId,
    ...(typeof order?.status === "string" ? { orderStatus: order.status } : {}),
    ...(typeof order?.orderId === "string" ? { orderId: order.orderId } : {}),
  };
}
