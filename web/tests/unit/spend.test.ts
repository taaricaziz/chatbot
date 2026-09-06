import { describe, expect, it } from "vitest";
import {
  checkBudget,
  costOfUsage,
  DEFAULT_BUDGET,
  DEFAULT_RATES,
  exhaustedMessage,
  formatUsd,
  karachiDayKey,
  karachiMonthKey,
  type Budget,
} from "@/lib/services/spend";

describe("cost arithmetic", () => {
  it("costs a plain call from its tokens", () => {
    // 1000 in at $15/M = 15_000 micro-USD; 500 out at $75/M = 37_500.
    const cost = costOfUsage(
      { inputTokens: 1000, outputTokens: 500 },
      DEFAULT_RATES,
    );
    expect(cost).toBe(52_500);
  });

  it("charges cache reads at a tenth of fresh input", () => {
    const fresh = costOfUsage({ inputTokens: 10_000, outputTokens: 0 }, DEFAULT_RATES);
    const cached = costOfUsage(
      { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 10_000 },
      DEFAULT_RATES,
    );
    expect(cached * 10).toBe(fresh);
  });

  it("treats absent cache fields as zero rather than NaN", () => {
    expect(costOfUsage({ inputTokens: 100, outputTokens: 100 }, DEFAULT_RATES))
      .toBeTypeOf("number");
    expect(
      Number.isNaN(costOfUsage({ inputTokens: 1, outputTokens: 1 }, DEFAULT_RATES)),
    ).toBe(false);
  });

  it("costs nothing at zero rates — a free tier reads as free", () => {
    const free = { inputPerMillion: 0, outputPerMillion: 0, cacheWritePerMillion: 0, cacheReadPerMillion: 0 };
    expect(costOfUsage({ inputTokens: 999_999, outputTokens: 999_999 }, free)).toBe(0);
  });

  it("returns an integer — micro-USD is never fractional", () => {
    const cost = costOfUsage(
      { inputTokens: 7, outputTokens: 3, cacheReadInputTokens: 11 },
      DEFAULT_RATES,
    );
    expect(Number.isInteger(cost)).toBe(true);
  });
});

describe("the budget", () => {
  const reading = (over: Partial<Parameters<typeof checkBudget>[0]> = {}) => ({
    callsToday: 0,
    callsThisConversation: 0,
    spentThisMonthMicroUsd: 0,
    ...over,
  });

  it("allows a fresh conversation", () => {
    expect(checkBudget(reading(), DEFAULT_BUDGET).allowed).toBe(true);
  });

  it("stops at the daily call quota", () => {
    const verdict = checkBudget(
      reading({ callsToday: DEFAULT_BUDGET.dailyCalls }),
      DEFAULT_BUDGET,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("DAILY_QUOTA");
  });

  it("stops one talkative conversation without stopping the day", () => {
    const verdict = checkBudget(
      reading({ callsThisConversation: DEFAULT_BUDGET.perConversationCalls }),
      DEFAULT_BUDGET,
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("CONVERSATION");
  });

  it("ignores money entirely when no monthly ceiling is set", () => {
    // The default. On a free tier there is no bill, so a spend limit nobody
    // funded must never be what denies service.
    expect(DEFAULT_BUDGET.monthlyMicroUsd).toBe(0);
    const verdict = checkBudget(
      reading({ spentThisMonthMicroUsd: 999_000_000 }),
      DEFAULT_BUDGET,
    );
    expect(verdict.allowed).toBe(true);
  });

  it("enforces a monthly ceiling once one is set", () => {
    const paid: Budget = { ...DEFAULT_BUDGET, monthlyMicroUsd: 5_000_000 };
    expect(checkBudget(reading({ spentThisMonthMicroUsd: 4_999_999 }), paid).allowed)
      .toBe(true);
    const verdict = checkBudget(reading({ spentThisMonthMicroUsd: 5_000_000 }), paid);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("MONTHLY_SPEND");
  });

  it("reports headroom against the TIGHTEST limit", () => {
    const verdict = checkBudget(
      reading({ callsToday: 0, callsThisConversation: DEFAULT_BUDGET.perConversationCalls - 3 }),
      DEFAULT_BUDGET,
    );
    expect(verdict.callsRemaining).toBe(3);
  });

  it("sits below the tightest free daily quota reported for any provider", () => {
    // Deliberately not tuned to one provider's current number: the defence is
    // staying well under the smallest plausible one.
    expect(DEFAULT_BUDGET.dailyCalls).toBeLessThanOrEqual(250);
  });
});

describe("what the customer is told", () => {
  it("never mentions quotas, errors or money", () => {
    for (const reason of ["DAILY_QUOTA", "CONVERSATION", "MONTHLY_SPEND"] as const) {
      const message = exhaustedMessage(reason).toLowerCase();
      for (const word of ["quota", "error", "limit", "budget", "$", "token"]) {
        expect(message, `${reason} said "${word}"`).not.toContain(word);
      }
    }
  });

  it("points at the site, which still works", () => {
    expect(exhaustedMessage("DAILY_QUOTA")).toMatch(/menu|site/i);
  });

  it("reassures that existing orders are safe when a chat is capped", () => {
    expect(exhaustedMessage("CONVERSATION")).toMatch(/safe/i);
  });
});

describe("Karachi days", () => {
  it("puts 20:00 UTC into the NEXT Karachi day", () => {
    // 20:00 UTC is 01:00 the following morning in Karachi (UTC+5).
    expect(karachiDayKey(new Date("2026-08-31T20:00:00Z"))).toBe("2026-09-01");
  });

  it("keeps a Friday dinner rush inside one budget day", () => {
    // 14:00-19:00 UTC is 19:00-midnight in Karachi: one evening, one day.
    const start = karachiDayKey(new Date("2026-08-28T14:00:00Z"));
    const end = karachiDayKey(new Date("2026-08-28T18:59:00Z"));
    expect(start).toBe(end);
  });

  it("rolls the month on Karachi midnight, not UTC midnight", () => {
    expect(karachiMonthKey(new Date("2026-08-31T19:30:00Z"))).toBe("2026-09");
  });
});

describe("formatting for staff", () => {
  it("shows four decimals for sub-cent amounts, which most calls are", () => {
    expect(formatUsd(1_200)).toBe("$0.0012");
  });

  it("shows normal money above a cent", () => {
    expect(formatUsd(1_234_000)).toBe("$1.23");
  });

  it("shows exactly zero as zero, not as 0.0000", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });
});
