/**
 * Sliding-window rate limiting.
 *
 * Pure and in-memory, so it is testable and needs no dependency. That comes
 * with a real limitation: the window is per-instance, so on serverless the
 * effective limit is (limit × instances). For this build that is acceptable —
 * the ceiling still stops a single client hammering an endpoint, which is the
 * threat that matters. Swap `hit()` for an Upstash Redis sliding window when
 * a single global limit actually matters.
 *
 * The endpoint this exists for above all is the AI assistant: every call costs
 * money, so an unmetered one is somebody else's budget to spend.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window frees up. Sent as Retry-After. */
  retryAfterSeconds: number;
  limit: number;
}

/** Named rules, so the numbers live in one place rather than at call sites. */
export const RULES = {
  /** Costs money per call — the tightest limit on the site. */
  agentChat: { limit: 12, windowMs: 60_000 },
  /** Cheap and called on every keystroke-ish change; generous. */
  quote: { limit: 60, windowMs: 60_000 },
  /** Writes. Nobody legitimately places six orders a minute. */
  createOrder: { limit: 6, windowMs: 60_000 },
  createReservation: { limit: 6, windowMs: 60_000 },
  /** Unauthenticated and database-heavy — the obvious scraping target. */
  availability: { limit: 40, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

type Bucket = number[];

const g = globalThis as unknown as { gooteeRateBuckets?: Map<string, Bucket> };
const buckets = (g.gooteeRateBuckets ??= new Map<string, Bucket>());

/**
 * Records a hit and reports whether it is allowed.
 *
 * A true sliding window (timestamps, not a fixed bucket): a fixed window lets
 * someone send 2× the limit across a boundary, which for a paid endpoint is
 * the difference that matters.
 */
export function hit(
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): RateLimitResult {
  const cutoff = now - rule.windowMs;
  const existing = buckets.get(key) ?? [];

  // Drop timestamps that have fallen out of the window.
  const recent = existing.filter((t) => t > cutoff);

  if (recent.length >= rule.limit) {
    buckets.set(key, recent);
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
      limit: rule.limit,
    };
  }

  recent.push(now);
  buckets.set(key, recent);

  // Opportunistic cleanup: without it a long-running process accumulates a
  // bucket per IP that ever visited.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }

  return {
    allowed: true,
    remaining: rule.limit - recent.length,
    retryAfterSeconds: 0,
    limit: rule.limit,
  };
}

/**
 * Best-effort client identity.
 *
 * Behind Vercel, `x-forwarded-for` is set by the platform. Locally it is
 * absent, so everything shares one bucket — fine, and it keeps the limiter
 * exercisable in development.
 */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return `${scope}:${ip}`;
}

/** For tests: forget everything. */
export function resetRateLimits(): void {
  buckets.clear();
}
