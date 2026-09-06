import { describe, expect, it } from "vitest";
import {
  formatEta,
  matchZone,
  normaliseAddress,
  quoteDelivery,
  type DeliveryZone,
} from "@/lib/services/delivery";
import { rupees } from "@/lib/money";

const zone = (
  name: string,
  fee: number,
  min: number,
  priority: number,
  matchTerms: string[],
): DeliveryZone => ({
  id: `z-${name}`,
  name,
  feePaisa: rupees(fee),
  minOrderPaisa: rupees(min),
  etaMinMinutes: 20,
  etaMaxMinutes: 40,
  matchTerms,
  priority,
  isActive: true,
});

const ZONES: DeliveryZone[] = [
  zone("Bukhari Commercial", 99, 600, 10, ["bukhari", "khayaban-e-shujaat"]),
  zone("DHA Phase 6", 119, 800, 20, ["phase 6", "ittehad"]),
  zone("DHA Phase 8", 199, 1200, 40, ["phase 8", "rahat"]),
  zone("Clifton", 249, 1500, 50, ["clifton", "teen talwar"]),
  zone("Defence (other)", 199, 1200, 90, ["dha", "defence"]),
];

describe("address normalisation", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normaliseAddress("  House 21,   STREET 4  ")).toBe("house 21 street 4");
  });

  it("strips punctuation that would break substring matching", () => {
    expect(normaliseAddress("Flat #3, Phase-6.")).toBe("flat 3 phase-6");
  });
});

describe("zone matching", () => {
  it("matches a straightforward address", () => {
    const m = matchZone(ZONES, "Plot 14-C, Lane 4, Bukhari Commercial Area");
    expect(m?.zone.name).toBe("Bukhari Commercial");
  });

  it("is case-insensitive", () => {
    expect(matchZone(ZONES, "CLIFTON BLOCK 4")?.zone.name).toBe("Clifton");
  });

  it("prefers the MOST SPECIFIC zone when several match", () => {
    // Contains both "bukhari" and "dha" — the specific one must win, or a
    // delivery two streets away gets charged the generic Defence fee.
    const m = matchZone(ZONES, "House 5, Bukhari Commercial, DHA, Karachi");
    expect(m?.zone.name).toBe("Bukhari Commercial");
    expect(m?.zone.feePaisa).toBe(rupees(99));
  });

  it("falls back to the broad zone when nothing specific matches", () => {
    const m = matchZone(ZONES, "Street 12, DHA, Karachi");
    expect(m?.zone.name).toBe("Defence (other)");
  });

  it("also searches the separate area field", () => {
    const m = matchZone(ZONES, "House 9, Street 3", "Phase 8");
    expect(m?.zone.name).toBe("DHA Phase 8");
  });

  it("returns null for somewhere we do not deliver", () => {
    expect(matchZone(ZONES, "Gulshan-e-Iqbal, Block 13")).toBeNull();
    expect(matchZone(ZONES, "Lahore")).toBeNull();
  });

  it("returns null for an empty address", () => {
    expect(matchZone(ZONES, "")).toBeNull();
    expect(matchZone(ZONES, "   ")).toBeNull();
  });

  it("ignores inactive zones", () => {
    const off = ZONES.map((z) =>
      z.name === "Clifton" ? { ...z, isActive: false } : z,
    );
    expect(matchZone(off, "Clifton Block 5")).toBeNull();
  });

  it("reports which term matched, so the choice is explainable", () => {
    expect(matchZone(ZONES, "Near Teen Talwar")?.matchedOn).toBe("teen talwar");
  });
});

describe("delivery quote", () => {
  it("quotes fee, minimum and an ETA window for a covered address", () => {
    const q = quoteDelivery(ZONES, "Bukhari Commercial", rupees(1500));
    expect(q.covered).toBe(true);
    expect(q.zoneName).toBe("Bukhari Commercial");
    expect(q.feePaisa).toBe(rupees(99));
    expect(q.etaMinMinutes).toBe(20);
    expect(q.etaMaxMinutes).toBe(40);
    expect(q.meetsMinimum).toBe(true);
    expect(q.shortfallPaisa).toBe(0);
  });

  it("reports an uncovered address without inventing a fee", () => {
    const q = quoteDelivery(ZONES, "Gulshan-e-Iqbal", rupees(3000));
    expect(q.covered).toBe(false);
    expect(q.feePaisa).toBe(0);
    expect(q.etaMinMinutes).toBeNull();
    expect(q.zoneName).toBeNull();
  });

  it("computes the exact shortfall below a minimum", () => {
    const q = quoteDelivery(ZONES, "Clifton Block 4", rupees(900));
    expect(q.meetsMinimum).toBe(false);
    expect(q.shortfallPaisa).toBe(rupees(600)); // 1500 - 900
  });

  it("treats an order exactly at the minimum as acceptable", () => {
    const q = quoteDelivery(ZONES, "Phase 6, Ittehad", rupees(800));
    expect(q.meetsMinimum).toBe(true);
    expect(q.shortfallPaisa).toBe(0);
  });

  it("charges more the further out the address is", () => {
    const near = quoteDelivery(ZONES, "Bukhari Commercial", rupees(3000));
    const mid = quoteDelivery(ZONES, "Phase 8, Rahat", rupees(3000));
    const far = quoteDelivery(ZONES, "Clifton", rupees(3000));

    expect(near.feePaisa).toBeLessThan(mid.feePaisa);
    expect(mid.feePaisa).toBeLessThan(far.feePaisa);
    expect(near.minOrderPaisa).toBeLessThan(far.minOrderPaisa);
  });
});

describe("ETA formatting", () => {
  it("always renders a window, never a single number", () => {
    expect(formatEta(20, 40)).toBe("20–40 min");
    expect(formatEta(20, 40)).toContain("–");
  });

  it("returns null when there is no zone to estimate from", () => {
    expect(formatEta(null, null)).toBeNull();
  });
});
