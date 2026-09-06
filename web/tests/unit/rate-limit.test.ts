import { beforeEach, describe, expect, it } from "vitest";
import {
  clientKey,
  hit,
  resetRateLimits,
  RULES,
  type RateLimitRule,
} from "@/lib/rate-limit";

const rule: RateLimitRule = { limit: 3, windowMs: 60_000 };

beforeEach(() => resetRateLimits());

describe("sliding window", () => {
  it("allows up to the limit then refuses", () => {
    for (let i = 1; i <= 3; i++) {
      expect(hit("k", rule).allowed, `request ${i}`).toBe(true);
    }
    expect(hit("k", rule).allowed).toBe(false);
  });

  it("counts down the remaining allowance", () => {
    expect(hit("k", rule).remaining).toBe(2);
    expect(hit("k", rule).remaining).toBe(1);
    expect(hit("k", rule).remaining).toBe(0);
  });

  it("keeps buckets separate per key", () => {
    for (let i = 0; i < 3; i++) hit("a", rule);
    expect(hit("a", rule).allowed).toBe(false);
    expect(hit("b", rule).allowed).toBe(true);
  });

  it("frees slots one at a time as each hit ages out", () => {
    // Spaced 20s apart, so they expire one by one. (Three hits at the SAME
    // instant would correctly free three slots together — that is the window
    // sliding, not a fixed bucket resetting.)
    const t0 = 1_000_000;
    hit("k", rule, t0);
    hit("k", rule, t0 + 20_000);
    hit("k", rule, t0 + 40_000);

    expect(hit("k", rule, t0 + 50_000).allowed).toBe(false);

    // Just before the first ages out: still full.
    expect(hit("k", rule, t0 + 59_999).allowed).toBe(false);

    // The first hit ages out — exactly ONE slot opens.
    expect(hit("k", rule, t0 + 60_001).allowed).toBe(true);
    // ...and the next request is blocked again, because the other two are
    // still inside the window. A fixed window would have released all three.
    expect(hit("k", rule, t0 + 60_002).allowed).toBe(false);
  });

  it("reports a usable Retry-After", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) hit("k", rule, t0);
    const blocked = hit("k", rule, t0 + 10_000);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("never reports a zero Retry-After while blocked", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) hit("k", rule, t0);
    const blocked = hit("k", rule, t0 + 59_999);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("the configured rules", () => {
  it("limits the AI assistant hardest — it is the one that costs money", () => {
    expect(RULES.agentChat.limit).toBeLessThan(RULES.quote.limit);
    expect(RULES.agentChat.limit).toBeLessThan(RULES.availability.limit);
  });

  it("keeps writes tight", () => {
    expect(RULES.createOrder.limit).toBeLessThanOrEqual(10);
    expect(RULES.createReservation.limit).toBeLessThanOrEqual(10);
  });

  it("leaves quoting generous — it fires on every checkout edit", () => {
    expect(RULES.quote.limit).toBeGreaterThanOrEqual(30);
  });

  it("uses a one-minute window throughout, so Retry-After is predictable", () => {
    for (const [name, r] of Object.entries(RULES)) {
      expect(r.windowMs, name).toBe(60_000);
    }
  });
});

describe("client identity", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://example.com", { headers });

  it("uses the first x-forwarded-for hop", () => {
    const key = clientKey(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), "agent");
    expect(key).toBe("agent:203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    expect(clientKey(req({ "x-real-ip": "198.51.100.4" }), "agent")).toBe(
      "agent:198.51.100.4",
    );
  });

  it("still produces a key with no proxy headers", () => {
    expect(clientKey(req({}), "agent")).toBe("agent:local");
  });

  it("scopes keys so one endpoint cannot exhaust another", () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    expect(clientKey(req(headers), "agent")).not.toBe(
      clientKey(req(headers), "order"),
    );
  });
});
