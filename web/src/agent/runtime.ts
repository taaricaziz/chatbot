import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeTool, TOOLS } from "./tools";
import {
  AgentUnavailableError,
  getProvider,
  type ConversationMessage,
  type ProviderRequest,
  type ProviderResponse,
} from "./provider";
import {
  checkBudget,
  costOfUsage,
  DEFAULT_BUDGET,
  DEFAULT_RATES,
  exhaustedMessage,
  type Budget,
  type ModelRates,
} from "@/lib/services/spend";
import { readLedger, recordSpend } from "@/lib/repositories/spend-ledger";
import { stripMarkdown } from "@/lib/text";

/**
 * The agent loop.
 *
 * A manual loop rather than an SDK tool runner: the thing that matters most
 * here — that no order is saved without a real confirmation — is worth being
 * able to read top to bottom in one function. It also has to run against
 * providers that have no tool runner at all.
 *
 * THERE IS ONE LOOP. `runAgentStream` is the implementation and `runAgent`
 * drains it. Forking it into a streaming and a non-streaming copy would mean
 * the confirmation gate existed twice, and two copies of a safety rule is one
 * copy of a safety rule.
 */

export { AgentUnavailableError };

/** Stops a wedged conversation from looping forever on the café's quota. */
const MAX_ITERATIONS = 8;

let cachedPrompt: string | null = null;

function systemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = readFileSync(
    join(process.cwd(), "src", "agent", "system-prompt.md"),
    "utf8",
  );
  return cachedPrompt;
}

/**
 * Budget from env, falling back to defaults sized below every free tier.
 * Read per call rather than at module load so changing it needs no redeploy
 * on platforms that inject env at runtime.
 */
/** Exported so a non-local brain (CafeBot) is held to the same call caps. */
export function budget(): Budget {
  const int = (name: string, fallback: number) => {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  };
  return {
    dailyCalls: int("AGENT_DAILY_CALLS", DEFAULT_BUDGET.dailyCalls),
    perConversationCalls: int(
      "AGENT_CONVERSATION_CALLS",
      DEFAULT_BUDGET.perConversationCalls,
    ),
    // Only meaningful on a paid provider; zero (off) is the default.
    monthlyMicroUsd: Math.floor(
      (Number(process.env.AGENT_MONTHLY_USD) || 0) * 1_000_000,
    ),
  };
}

/** Zero across the board — a free tier has no bill to estimate. */
const FREE_RATES: ModelRates = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  cacheWritePerMillion: 0,
  cacheReadPerMillion: 0,
};

/**
 * A free provider must report zero, not an estimate.
 *
 * Pricing free tokens at paid rates puts a confident dollar figure in the
 * staff console for money nobody is being charged — worse than showing
 * nothing, because it looks authoritative.
 */
function rates(provider: { free: boolean }): ModelRates {
  return provider.free ? FREE_RATES : DEFAULT_RATES;
}

/**
 * What the customer is told while a tool runs.
 *
 * Present tense, no promises, and never the tool's name — "check_order_status"
 * is not something to show a person. Each one has to stay true even when the
 * tool then fails.
 */
const TOOL_LABELS: Record<string, string> = {
  search_menu: "Looking at the menu",
  price_cart: "Working out the total",
  place_order: "Placing your order",
  check_order_status: "Checking your order",
  check_table_availability: "Checking the diary",
  book_table: "Booking the table",
  request_human: "Finding someone to help",
};

export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolTrace {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  error?: string;
  /** Set by place_order, so a transcript can link to the order it created. */
  orderNumber?: string;
}

export interface AgentReply {
  reply: string;
  toolTrace: ToolTrace[];
  /** True if the loop hit its ceiling rather than finishing. */
  truncated: boolean;
  /** True when the meter stopped us rather than the model finishing. */
  exhausted?: boolean;
  costMicroUsd: number;
  provider: string;
  model: string;
}

export type AgentEvent =
  /** A fragment of the reply, as the model writes it. */
  | { type: "text"; delta: string }
  /** A tool is running. Shown as a status line, not as part of the reply. */
  | { type: "tool"; label: string }
  | { type: "done"; result: AgentReply };

export interface RunOptions {
  /** Groups calls for the per-conversation cap and the transcript record. */
  conversationId: string;
}

export async function* runAgentStream(
  history: AgentTurn[],
  userMessage: string,
  options: RunOptions,
): AsyncGenerator<AgentEvent> {
  const provider = getProvider();
  const limits = budget();
  const rateCard = rates(provider);

  const messages: ConversationMessage[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: userMessage },
  ];

  const toolTrace: ToolTrace[] = [];
  // Text from EVERY iteration, not just the last: a model that says "let me
  // check that" before calling a tool has said something to the customer, and
  // dropping it would make the transcript disagree with what they saw.
  const spoken: string[] = [];
  let costMicroUsd = 0;

  const finish = (
    reply: string,
    extra: Partial<AgentReply> = {},
  ): AgentEvent => ({
    type: "done",
    result: {
      reply,
      toolTrace,
      truncated: false,
      costMicroUsd,
      provider: provider.id,
      model: provider.model,
      ...extra,
    },
  });

  // Stripped here as well as in the widget, so the transcript staff read and
  // the bubble the customer saw are the same words.
  const said = () =>
    stripMarkdown(spoken.filter(Boolean).join("\n\n")).trim();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Checked before EVERY call, not once per turn: a tool-using turn makes
    // several, and the quota is made of calls.
    const verdict = checkBudget(readLedger(options.conversationId), limits);
    if (!verdict.allowed) {
      const message = exhaustedMessage(verdict.reason!);
      yield { type: "text", delta: message };
      yield finish(message, { exhausted: true });
      return;
    }

    const request: ProviderRequest = {
      system: systemPrompt(),
      messages,
      tools: TOOLS,
    };

    let response: ProviderResponse;

    if (provider.completeStream) {
      let final: ProviderResponse | undefined;
      for await (const event of provider.completeStream(request)) {
        if (event.type === "text") yield event;
        else final = event.response;
      }
      if (!final) {
        throw new AgentUnavailableError(
          `${provider.id} ended the stream without a result.`,
        );
      }
      response = final;
    } else {
      // No streaming from this provider: the text arrives whole. Emitted as a
      // single delta so the caller never has to know which it got.
      response = await provider.complete(request);
      if (response.text) yield { type: "text", delta: response.text };
    }

    const callCost = costOfUsage(response.usage, rateCard);
    costMicroUsd += callCost;
    recordSpend(options.conversationId, callCost);

    if (response.refused) {
      const message =
        "Sorry — I can't help with that one. Ask me about the menu, an " +
        "order, or booking a table.";
      yield { type: "text", delta: message };
      yield finish(message);
      return;
    }

    spoken.push(response.text);

    if (response.toolCalls.length === 0) {
      // An empty bubble reads as a bug, so say something true instead — and
      // WHICH true thing depends on why it is empty. A reasoning model that
      // spent its whole budget thinking has not failed to understand; asking
      // the customer to rephrase would be a lie and would not help.
      const fallback = response.truncated
        ? "Sorry — that got away from me. Could you ask for a bit less at once?"
        : "Sorry — I didn't catch that. Could you say it another way?";

      const reply = said() || fallback;
      if (!said()) yield { type: "text", delta: reply };
      yield finish(reply);
      return;
    }

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      yield { type: "tool", label: TOOL_LABELS[call.name] ?? "Working on it" };

      const outcome = await executeTool(call.name, call.input);

      toolTrace.push({
        name: call.name,
        input: call.input,
        ok: outcome.ok === true,
        ...(outcome.error ? { error: String(outcome.error) } : {}),
        ...(typeof (outcome as Record<string, unknown>).orderNumber === "string"
          ? { orderNumber: (outcome as Record<string, string>).orderNumber }
          : {}),
      });

      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(outcome),
        // Marked as an error so the model treats a refusal as something to
        // recover from rather than a fact to relay.
        isError: outcome.ok === false,
      });
    }
  }

  const stuck =
    "Sorry — I got a bit tangled there. Could you tell me again what " +
    "you'd like?";
  yield { type: "text", delta: stuck };
  yield finish(stuck, { truncated: true });
}

/** The whole reply at once, for callers that cannot stream. */
export async function runAgent(
  history: AgentTurn[],
  userMessage: string,
  options: RunOptions,
): Promise<AgentReply> {
  for await (const event of runAgentStream(history, userMessage, options)) {
    if (event.type === "done") return event.result;
  }
  // The generator always yields a done event before returning; this exists so
  // the type is honest rather than asserted away.
  throw new AgentUnavailableError("The assistant produced no reply.");
}
