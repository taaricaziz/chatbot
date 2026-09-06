/**
 * Who sees the assistant during a soft launch.
 *
 * Pure: a bucket in, a yes or no out. No env, no cookies, no clock — those
 * belong to the caller, and keeping them out is what makes every rule here
 * testable without a request.
 *
 * This is NOT a security control. A visitor who forges their bucket gets an
 * assistant, which costs them nothing and us one metered call. The daily
 * quota is the real cap; this only decides how many people are OFFERED it
 * while we are still reading every transcript.
 */

/** Buckets are 0-99, so a percentage maps to them directly. */
export const BUCKETS = 100;

/**
 * FNV-1a. Small, dependency-free, and — the property that matters — stable:
 * the same visitor lands in the same bucket on every page, so the assistant
 * does not flicker in and out as they browse.
 */
export function bucketFor(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    // The FNV prime, via shifts, to stay in 32-bit integer arithmetic.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % BUCKETS;
}

/**
 * `percent` is clamped, so a typo in configuration cannot open the gate wider
 * than 100 or produce a negative that silently means "everyone".
 */
export function isInRollout(bucket: number, percent: number): boolean {
  const clamped = Math.max(0, Math.min(100, Math.floor(percent)));
  if (clamped >= 100) return true;
  if (clamped <= 0) return false;
  return bucket < clamped;
}

/** A fresh visitor token. Opaque and meaningless — it identifies nobody. */
export function newVisitorToken(): string {
  return crypto.randomUUID();
}
