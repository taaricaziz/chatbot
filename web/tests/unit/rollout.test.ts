import { describe, expect, it } from "vitest";
import {
  BUCKETS,
  bucketFor,
  isInRollout,
  newVisitorToken,
} from "@/lib/services/rollout";

describe("bucketing a visitor", () => {
  it("always lands inside the range", () => {
    for (let i = 0; i < 500; i++) {
      const bucket = bucketFor(newVisitorToken());
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(BUCKETS);
      expect(Number.isInteger(bucket)).toBe(true);
    }
  });

  it("is stable — the assistant must not flicker between pages", () => {
    const token = newVisitorToken();
    const first = bucketFor(token);
    for (let i = 0; i < 10; i++) expect(bucketFor(token)).toBe(first);
  });

  it("separates visitors rather than sending everyone to one bucket", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(bucketFor(newVisitorToken()));
    // A hash that collapsed would show a handful of buckets. Anything above
    // half of them is a healthy spread.
    expect(seen.size).toBeGreaterThan(BUCKETS / 2);
  });

  it("spreads roughly evenly, so 10% means about 10%", () => {
    let inside = 0;
    const sample = 5000;
    for (let i = 0; i < sample; i++) {
      if (isInRollout(bucketFor(newVisitorToken()), 10)) inside++;
    }
    const share = (inside / sample) * 100;
    // Generous bounds: this asserts the hash is not badly skewed, not that
    // randomness behaves itself on any given run.
    expect(share).toBeGreaterThan(6);
    expect(share).toBeLessThan(15);
  });

  it("handles an empty token without throwing", () => {
    expect(bucketFor("")).toBeGreaterThanOrEqual(0);
  });
});

describe("the rollout gate", () => {
  it("lets everyone in at 100", () => {
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      expect(isInRollout(bucket, 100)).toBe(true);
    }
  });

  it("lets nobody in at 0", () => {
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      expect(isInRollout(bucket, 0)).toBe(false);
    }
  });

  it("admits exactly the configured share", () => {
    const admitted = Array.from({ length: BUCKETS }, (_, b) =>
      isInRollout(b, 25),
    ).filter(Boolean).length;
    expect(admitted).toBe(25);
  });

  it("clamps a nonsense percentage instead of opening wide", () => {
    // A typo must not silently mean "everyone" or crash the page.
    expect(isInRollout(50, -20)).toBe(false);
    expect(isInRollout(99, 900)).toBe(true);
    expect(isInRollout(50, 12.7)).toBe(false);
    expect(isInRollout(11, 12.7)).toBe(true);
  });

  it("grows monotonically — raising the percentage never drops anyone", () => {
    // Somebody who could use the assistant yesterday must not lose it when
    // the rollout widens.
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      let wasIn = false;
      for (let percent = 0; percent <= 100; percent++) {
        const now = isInRollout(bucket, percent);
        if (wasIn) expect(now, `bucket ${bucket} at ${percent}%`).toBe(true);
        wasIn = now;
      }
    }
  });
});
