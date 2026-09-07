import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AgentUnavailableError,
  runAgent,
  runAgentStream,
  type AgentReply,
} from "@/agent/runtime";
import { clientKey, hit, RULES } from "@/lib/rate-limit";
import { appendTranscript } from "@/lib/repositories/transcripts";
import { agentBrain, agentEnabled } from "@/lib/agent-config";
import { askCafeBot, CafeBotError } from "@/lib/channels/cafebot";
import { budget } from "@/agent/runtime";
import { checkBudget, exhaustedMessage } from "@/lib/services/spend";
import { readLedger, recordSpend } from "@/lib/repositories/spend-ledger";

/**
 * POST /api/agent/chat
 *
 * Stateless as far as the CONVERSATION goes: the client sends the history
 * back each turn, so there is no server-side session to expire. The
 * conversationId is not state — it is a grouping key for the per-conversation
 * quota and the transcript record, and it is deliberately not trusted for
 * anything a caller could gain by forging it.
 *
 * Streams when the caller asks for `text/event-stream`, returns JSON
 * otherwise. One endpoint rather than two, so the rate limit, the launch gate
 * and the transcript write cannot get out of step between them.
 */
const schema = z.object({
  message: z.string().trim().min(1).max(1000),
  // Client-generated. Forging it can only split or merge one's OWN quota
  // bucket, and the daily cap sits behind it either way.
  conversationId: z.string().trim().min(8).max(64).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(24)
    .default([]),
});

function tooMany(result: { retryAfterSeconds: number; limit: number }) {
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "That's a lot of requests. Give it a moment and try again.",
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
      },
    },
  );
}

/** Detail goes to the log; the customer gets whichever of these is true. */
const RESTING =
  "The assistant is resting for now. The full menu is right here on the " +
  "site, and you can order or book without me.";

/**
 * A free tier's per-minute window clears in seconds. Telling someone the
 * assistant is "resting" when it will answer again shortly sends them away
 * for no reason.
 */
const BUSY =
  "Lots of people are asking at once — give me about a minute and try " +
  "again. The menu and checkout work as normal in the meantime.";

/** Server-sent events from a fixed list, for replies that arrive whole. */
function sse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = events.map((e) => `data: ${JSON.stringify(e)}

`).join("");
  return new Response(encoder.encode(body), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}

/**
 * A reply that arrived all at once, in whichever shape the caller asked for.
 * The streaming shape is one text delta then done, so the widget code path
 * is identical to a streamed reply — it just happens fast.
 */
function respond(
  stream: boolean,
  result: { reply: string; conversationId: string; exhausted: boolean },
): Response {
  if (stream) {
    return sse([
      { type: "text", delta: result.reply },
      { type: "done", reply: result.reply, truncated: false,
        exhausted: result.exhausted, conversationId: result.conversationId },
    ]);
  }
  return NextResponse.json(
    { reply: result.reply, toolTrace: [], truncated: false,
      exhausted: result.exhausted, conversationId: result.conversationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // Rate limit BEFORE parsing the body: a flood should cost as little as
  // possible to reject.
  const limit = hit(clientKey(request, "agent"), RULES.agentChat);
  if (!limit.allowed) return tooMany(limit);

  // The soft-launch gate, checked on the SERVER. The widget also hides itself
  // when the assistant is off, but that is a courtesy, not the control.
  if (!agentEnabled()) {
    return NextResponse.json(
      {
        error: {
          code: "DISABLED",
          message: "The assistant is not taking messages right now.",
        },
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "That message is not valid." } },
      { status: 400 },
    );
  }

  const { message, history } = parsed.data;
  const conversationId = parsed.data.conversationId ?? crypto.randomUUID();

  // Recorded whatever happened, including exhausted and truncated replies —
  // those are the transcripts most worth reading.
  const record = (result: AgentReply) =>
    appendTranscript({
      id: conversationId,
      userMessage: message,
      assistantReply: result.reply,
      toolTrace: result.toolTrace,
      costMicroUsd: result.costMicroUsd,
    });

  const wantsStream = (request.headers.get("accept") ?? "").includes(
    "text/event-stream",
  );

  // ---------------------------------------------------------------- CafeBot
  // The original assistant, asked over HTTP. It shares everything above —
  // the rate limit, the kill switch, validation, the transcript — and the
  // call caps below, because it runs on a paid model and an unmetered brain
  // is somebody else's budget to spend. What it cannot do is stream, so the
  // reply arrives as one delta.
  if (agentBrain() === "cafebot") {
    const verdict = checkBudget(readLedger(conversationId), budget());
    if (!verdict.allowed) {
      const reply = exhaustedMessage(verdict.reason!);
      record({ reply, toolTrace: [], truncated: false, exhausted: true,
               costMicroUsd: 0, provider: "cafebot", model: "cafebot" });
      return respond(wantsStream, { reply, conversationId, exhausted: true });
    }

    try {
      const answer = await askCafeBot({ message, history, sessionId: conversationId });
      // Counted as one call; CafeBot's own bill is not ours to estimate.
      recordSpend(conversationId, 0);

      // CafeBot's confirmed order id, surfaced in the console like a local
      // order number would be.
      const toolTrace = answer.orderId
        ? [{ name: "cafebot", input: { status: answer.orderStatus ?? "confirmed" },
             ok: true, orderNumber: answer.orderId }]
        : [];

      record({ reply: answer.reply, toolTrace, truncated: false,
               costMicroUsd: 0, provider: "cafebot", model: "cafebot" });
      return respond(wantsStream, { reply: answer.reply, conversationId, exhausted: false });
    } catch (error) {
      const retryable = error instanceof CafeBotError && error.retryable;
      console.warn("[agent/chat] cafebot:", error instanceof Error ? error.message : error);
      const message = retryable ? BUSY : RESTING;
      if (wantsStream) {
        return sse([{ type: "error", message }]);
      }
      return NextResponse.json(
        { error: { code: retryable ? "BUSY" : "UNAVAILABLE", message } },
        { status: 503, ...(retryable ? { headers: { "Retry-After": "30" } } : {}) },
      );
    }
  }

  if (!wantsStream) {
    try {
      const result = await runAgent(history, message, { conversationId });
      record(result);
      return NextResponse.json(
        {
          reply: result.reply,
          toolTrace: result.toolTrace,
          truncated: result.truncated,
          exhausted: result.exhausted ?? false,
          conversationId,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof AgentUnavailableError) {
        // A free tier's per-minute throttle and a missing key are both
        // "unavailable" to us but very different to a customer, so they get
        // different words. The detail goes to the log, never to the page.
        console.warn("[agent/chat] unavailable:", error.message);
        return NextResponse.json(
          {
            error: {
              code: error.retryable ? "BUSY" : "UNAVAILABLE",
              message: error.retryable ? BUSY : RESTING,
            },
          },
          // 503 either way, but Retry-After turns a guess into a fact.
          {
            status: 503,
            ...(error.retryable ? { headers: { "Retry-After": "60" } } : {}),
          },
        );
      }
      console.error("[agent/chat] unexpected", error);
      return NextResponse.json(
        { error: { code: "INTERNAL", message: "The assistant is having trouble." } },
        { status: 500 },
      );
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        for await (const event of runAgentStream(history, message, {
          conversationId,
        })) {
          if (event.type === "done") {
            record(event.result);
            send({
              type: "done",
              reply: event.result.reply,
              truncated: event.result.truncated,
              exhausted: event.result.exhausted ?? false,
              conversationId,
            });
          } else {
            send(event);
          }
        }
      } catch (error) {
        // Headers are already sent with a 200, so a failure cannot become a
        // status code — it becomes an event the widget renders as an error.
        const unavailable = error instanceof AgentUnavailableError;
        if (unavailable) {
          console.warn("[agent/chat] unavailable:", (error as Error).message);
        } else {
          console.error("[agent/chat] unexpected", error);
        }
        const retryable =
          error instanceof AgentUnavailableError && error.retryable;
        send({
          type: "error",
          message: retryable
            ? BUSY
            : unavailable
              ? RESTING
              : "The assistant is having trouble.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style proxies buffering the whole response and undoing
      // the entire point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
