/**
 * What the assistant is allowed to cost.
 *
 * The rate limiter caps requests per IP. It does not cap SPEND — a hundred
 * genuinely curious visitors are all within their limit and still add up to a
 * real bill. This is the meter that actually stops.
 *
 * Pure, like pricing.ts: no env reads, no clock of its own, no I/O. The ledger
 * that remembers yesterday lives in the repository; this file only knows
 * arithmetic and rules, so every rule below is testable without a network.
 *
 * MONEY UNIT: integer micro-USD (millionths of a dollar), never floats — the
 * same discipline as paisa, applied to the currency Anthropic actually bills
 * in. Rs. conversion happens at the edge, for display only.
 */

/** Tokens as the API reports them. Cache fields are absent on some responses. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/**
 * Price per MILLION tokens, in micro-USD. $15.00/M is 15_000_000.
 *
 * These are configuration, not fact. The ledger is only ever as accurate as
 * these four numbers, so they are overridable by env and the preflight check
 * warns when they have never been reviewed. Verify against the published
 * pricing page for whichever model AGENT_MODEL names before trusting a bill.
 */
export interface ModelRates {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

/** Opus-class defaults. Input $15/M, output $75/M, cache write +25%, read 10%. */
export const DEFAULT_RATES: ModelRates = {
  inputPerMillion: 15_000_000,
  outputPerMillion: 75_000_000,
  cacheWritePerMillion: 18_750_000,
  cacheReadPerMillion: 1_500_000,
};

/** Half away from zero, so a half-micro-dollar never rounds in our favour. */
function round(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Cost of one API response, in micro-USD. */
export function costOfUsage(usage: TokenUsage, rates: ModelRates): number {
  const parts =
    usage.inputTokens * rates.inputPerMillion +
    usage.outputTokens * rates.outputPerMillion +
    (usage.cacheCreationInputTokens ?? 0) * rates.cacheWritePerMillion +
    (usage.cacheReadInputTokens ?? 0) * rates.cacheReadPerMillion;

  return round(parts / 1_000_000);
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface Budget {
  /**
   * Requests allowed per Karachi day. This is the control that actually
   * binds, because every free tier is metered in REQUESTS, not dollars.
   */
  dailyCalls: number;
  /** Model calls one conversation may make, so one person cannot drain the day. */
  perConversationCalls: number;
  /**
   * Optional hard ceiling in micro-USD per Karachi month. ZERO MEANS OFF,
   * which is the default: on a free tier there is no bill to cap, and a
   * money ceiling nobody has funded would only deny service for a number
   * that means nothing. Set it the day the provider starts charging.
   */
  monthlyMicroUsd: number;
}

/**
 * Deliberately below every free tier we might sit on, not tuned to one.
 *
 * Free-tier request quotas move around and the published figures disagree
 * with each other, so the defence is to stay comfortably under the smallest
 * plausible one rather than to track any provider's current number. 200
 * conversations a day is far more than a demonstration site will see and far
 * less than the tightest free daily quota reported for any provider below.
 */
export const DEFAULT_BUDGET: Budget = {
  dailyCalls: 200,
  // A single ordering conversation needs perhaps 6-10 model calls including
  // tool round-trips. 40 is generous; 400 is somebody enjoying themselves.
  perConversationCalls: 40,
  monthlyMicroUsd: 0,
};

export interface LedgerReading {
  callsToday: number;
  callsThisConversation: number;
  spentThisMonthMicroUsd: number;
}

export type DenialReason = "DAILY_QUOTA" | "CONVERSATION" | "MONTHLY_SPEND";

export interface BudgetVerdict {
  allowed: boolean;
  reason?: DenialReason;
  /** Calls still available against the tightest binding limit. */
  callsRemaining: number;
}

/**
 * May we make one more model call?
 *
 * Checked BEFORE the call. It cannot know what the next call will cost, so
 * one call can push a money ceiling slightly past it — the breaker trips on
 * the one after. That is the right trade: refusing on a guess would deny
 * service on days that had budget left. Request quotas have no such problem;
 * they are exact, which is another reason to make them the binding control.
 */
export function checkBudget(
  reading: LedgerReading,
  budget: Budget,
): BudgetVerdict {
  if (budget.monthlyMicroUsd > 0 &&
      reading.spentThisMonthMicroUsd >= budget.monthlyMicroUsd) {
    return { allowed: false, reason: "MONTHLY_SPEND", callsRemaining: 0 };
  }

  const dayLeft = budget.dailyCalls - reading.callsToday;
  if (dayLeft <= 0) return { allowed: false, reason: "DAILY_QUOTA", callsRemaining: 0 };

  const convoLeft = budget.perConversationCalls - reading.callsThisConversation;
  if (convoLeft <= 0)
    return { allowed: false, reason: "CONVERSATION", callsRemaining: 0 };

  return { allowed: true, callsRemaining: Math.min(dayLeft, convoLeft) };
}

/**
 * What the customer is told when the meter stops.
 *
 * Never "quota", never "error" — none of that is the customer's problem. The
 * café is still open and the site still works, so the message says so.
 */
export function exhaustedMessage(reason: DenialReason): string {
  if (reason === "CONVERSATION") {
    return (
      "We have covered a lot in this chat — start a fresh one and I will pick " +
      "right back up. Anything you have already ordered is safe."
    );
  }
  return (
    "The assistant is resting for now. The full menu is right here on the " +
    "site, and you can order or book a table without me."
  );
}

// ---------------------------------------------------------------------------
// Karachi days
// ---------------------------------------------------------------------------

/**
 * Pakistan Standard Time is UTC+5 with no daylight saving, ever — so the day
 * boundary is exact arithmetic and needs no timezone database.
 *
 * The budget resets at Karachi midnight rather than UTC midnight because a
 * café's day is the café's day: a busy Friday evening (UTC 14:00-19:00) must
 * not be split across two budget days.
 */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** `2026-08-31` in Karachi, for the given instant. */
export function karachiDayKey(at: Date): string {
  return new Date(at.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** `2026-08` in Karachi. */
export function karachiMonthKey(at: Date): string {
  return karachiDayKey(at).slice(0, 7);
}

/** Micro-USD as `$0.0123` / `$1.23`, for the staff console only. */
export function formatUsd(microUsd: number): string {
  const dollars = microUsd / 1_000_000;
  if (dollars !== 0 && Math.abs(dollars) < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
