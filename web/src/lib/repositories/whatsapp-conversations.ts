import "server-only";
import type { AgentTurn } from "@/agent/runtime";
import { WINDOW_HOURS } from "@/lib/channels/whatsapp";

/**
 * Conversation state for WhatsApp.
 *
 * The web widget is stateless on the server: the browser sends the history
 * back each turn. WhatsApp cannot — a phone sends one message and nothing
 * else — so the server has to remember, and this is the only place in the
 * app that does.
 *
 * In memory, bounded, and expiring on Meta's own 24-hour service window:
 * once that closes a free-form reply cannot be delivered anyway, so holding
 * the history past it would keep data for no purpose.
 *
 * DEDUPE lives here too, and is not optional. Meta retries a webhook it
 * considers unacknowledged; without this, one customer message becomes two
 * agent runs and potentially two orders.
 */

interface Conversation {
  turns: AgentTurn[];
  lastInboundAt: number;
}

interface State {
  byNumber: Map<string, Conversation>;
  seenMessageIds: Map<string, number>;
}

const g = globalThis as unknown as { gooteeWhatsApp?: State };
const state = (g.gooteeWhatsApp ??= {
  byNumber: new Map(),
  seenMessageIds: new Map(),
});

const WINDOW_SECONDS = WINDOW_HOURS * 3600;
const MAX_TURNS = 20;
const MAX_CONVERSATIONS = 500;
const MAX_SEEN = 5000;

/**
 * True the FIRST time a message id is seen, false every time after.
 *
 * Called before any work is done, so a retry costs nothing.
 */
export function claimMessage(id: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (state.seenMessageIds.has(id)) return false;
  state.seenMessageIds.set(id, nowSeconds);

  if (state.seenMessageIds.size > MAX_SEEN) {
    // Drop the oldest half. Insertion order is chronological, and an id old
    // enough to fall out is old enough that Meta has stopped retrying it.
    const half = Math.floor(state.seenMessageIds.size / 2);
    for (const key of [...state.seenMessageIds.keys()].slice(0, half)) {
      state.seenMessageIds.delete(key);
    }
  }
  return true;
}

export function historyFor(
  waId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): AgentTurn[] {
  const conversation = state.byNumber.get(waId);
  if (!conversation) return [];

  // Past the window this is a new conversation, not a continued one.
  if (nowSeconds - conversation.lastInboundAt >= WINDOW_SECONDS) {
    state.byNumber.delete(waId);
    return [];
  }
  return conversation.turns;
}

export function remember(
  waId: string,
  userMessage: string,
  assistantReply: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  const existing = state.byNumber.get(waId);
  const turns = existing && nowSeconds - existing.lastInboundAt < WINDOW_SECONDS
    ? existing.turns
    : [];

  turns.push({ role: "user", content: userMessage });
  turns.push({ role: "assistant", content: assistantReply });

  // Keep the tail: the recent exchange is what the next reply depends on,
  // and an unbounded history would eventually exceed the token budget the
  // free tier allows per minute.
  while (turns.length > MAX_TURNS) turns.shift();

  state.byNumber.set(waId, { turns, lastInboundAt: nowSeconds });

  if (state.byNumber.size > MAX_CONVERSATIONS) {
    for (const [key, value] of state.byNumber) {
      if (nowSeconds - value.lastInboundAt >= WINDOW_SECONDS) {
        state.byNumber.delete(key);
      }
    }
  }
}

/** For tests. */
export function resetWhatsApp(): void {
  state.byNumber.clear();
  state.seenMessageIds.clear();
}
