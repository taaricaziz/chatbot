import "server-only";
import {
  karachiDayKey,
  karachiMonthKey,
  type TokenUsage,
} from "@/lib/services/spend";

/**
 * The ledger the budget is checked against.
 *
 * In memory, pinned to globalThis for the same reason everything else here is
 * (Next bundles route handlers and RSC pages separately, so a plain module
 * constant is two different constants). That means a restart forgives the
 * day's spend — acceptable while this is a demonstration, and the honest
 * limitation to record rather than paper over. Moving it to Postgres is one
 * table and one upsert; the interface below does not change.
 */

interface Totals {
  microUsd: number;
  calls: number;
}

interface LedgerState {
  days: Map<string, Totals>;
  months: Map<string, Totals>;
  conversations: Map<string, Totals>;
}

const g = globalThis as unknown as { gooteeSpendLedger?: LedgerState };
const ledger = (g.gooteeSpendLedger ??= {
  days: new Map(),
  months: new Map(),
  conversations: new Map(),
});

const ZERO: Totals = { microUsd: 0, calls: 0 };

function add(map: Map<string, Totals>, key: string, microUsd: number): void {
  const current = map.get(key) ?? { microUsd: 0, calls: 0 };
  map.set(key, { microUsd: current.microUsd + microUsd, calls: current.calls + 1 });
}

export function readLedger(conversationId: string, at = new Date()) {
  const day = ledger.days.get(karachiDayKey(at)) ?? ZERO;
  const month = ledger.months.get(karachiMonthKey(at)) ?? ZERO;
  const convo = ledger.conversations.get(conversationId) ?? ZERO;
  return {
    callsToday: day.calls,
    callsThisConversation: convo.calls,
    spentThisMonthMicroUsd: month.microUsd,
  };
}

/**
 * Record one model call and what it cost, after it returned.
 *
 * Deliberately post-hoc rather than reserve/commit: reserving would mean
 * guessing the cost of a response nobody has seen yet, and a wrong guess
 * either denies service or under-counts. The CALL is counted either way, and
 * the call count is what the quota is actually made of.
 */
export function recordSpend(
  conversationId: string,
  microUsd: number,
  at = new Date(),
): void {
  add(ledger.days, karachiDayKey(at), microUsd);
  add(ledger.months, karachiMonthKey(at), microUsd);
  add(ledger.conversations, conversationId, microUsd);

  // A conversation entry per visitor accumulates forever otherwise. Days and
  // months are small and bounded; conversations are not.
  if (ledger.conversations.size > 2000) {
    const oldest = [...ledger.conversations.keys()].slice(0, 1000);
    for (const key of oldest) ledger.conversations.delete(key);
  }
}

export interface SpendSummary {
  today: Totals;
  month: Totals;
  dayKey: string;
  monthKey: string;
}

/** For the staff console. */
export function spendSummary(at = new Date()): SpendSummary {
  const dayKey = karachiDayKey(at);
  const monthKey = karachiMonthKey(at);
  return {
    dayKey,
    monthKey,
    today: ledger.days.get(dayKey) ?? ZERO,
    month: ledger.months.get(monthKey) ?? ZERO,
  };
}

/** Sums a usage block into the running total. Kept here so callers pass raw SDK usage. */
export function usageFrom(raw: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): TokenUsage {
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    cacheCreationInputTokens: raw.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: raw.cache_read_input_tokens ?? 0,
  };
}

/** For tests. */
export function resetLedger(): void {
  ledger.days.clear();
  ledger.months.clear();
  ledger.conversations.clear();
}
