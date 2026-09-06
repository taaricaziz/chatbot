import { describe, expect, it } from "vitest";
import {
  calculateTotals,
  PricingError,
  TAX_BP_CASH,
  TAX_BP_DIGITAL,
  taxDeltaBetweenMethods,
  taxRateBpFor,
  type PricedLine,
  type PricingInput,
} from "@/lib/services/pricing";
import { rupees } from "@/lib/money";

/** Rs. 1,860 spaghetti — the anchor price used throughout the build. */
const spaghetti = (quantity = 1, modifiers: PricedLine["modifiers"] = []): PricedLine => ({
  menuItemId: "pa-01",
  name: "Chilli Garlic Chicken Spaghetti",
  unitPricePaisa: rupees(1860),
  quantity,
  modifiers,
});

const chai = (quantity = 1): PricedLine => ({
  menuItemId: "hb-03",
  name: "Karak Chai",
  unitPricePaisa: rupees(380),
  quantity,
  modifiers: [],
});

const base = (over: Partial<PricingInput> = {}): PricingInput => ({
  lines: [spaghetti()],
  orderType: "TAKEAWAY",
  paymentMethod: "CASH",
  ...over,
});

describe("tax rate by payment method", () => {
  it("charges 15% on cash", () => {
    expect(taxRateBpFor("CASH")).toBe(TAX_BP_CASH);
    expect(TAX_BP_CASH).toBe(1500);
  });

  it("charges 8% on every digital method", () => {
    for (const m of ["CARD_ON_DELIVERY", "CARD_AT_COUNTER", "ONLINE"] as const) {
      expect(taxRateBpFor(m)).toBe(TAX_BP_DIGITAL);
    }
    expect(TAX_BP_DIGITAL).toBe(800);
  });

  it("changes the grand total when the customer switches payment method", () => {
    const input = base();
    const cash = calculateTotals({ ...input, paymentMethod: "CASH" });
    const card = calculateTotals({ ...input, paymentMethod: "ONLINE" });

    expect(cash.taxPaisa).toBe(rupees(279)); // 1860 * 0.15
    expect(card.taxPaisa).toBe(rupees(148.8)); // 1860 * 0.08
    expect(cash.totalPaisa).not.toBe(card.totalPaisa);
    expect(cash.totalPaisa - card.totalPaisa).toBe(rupees(130.2));
  });

  it("reports the delta between methods for the checkout UI", () => {
    // ~Rs. 4,000 order: the difference the plan cites as ~Rs. 280.
    const input = base({ lines: [spaghetti(2)] }); // Rs. 3,720
    const delta = taxDeltaBetweenMethods(input, "CASH", "ONLINE");
    expect(delta).toBe(-rupees(260.4));
    expect(Math.abs(delta)).toBeGreaterThan(rupees(250));
  });

  it("stores the applied rate on the breakdown so old orders reconcile", () => {
    expect(calculateTotals(base({ paymentMethod: "CASH" })).taxRateBp).toBe(1500);
    expect(calculateTotals(base({ paymentMethod: "ONLINE" })).taxRateBp).toBe(800);
  });
});

describe("subtotals", () => {
  it("multiplies unit price by quantity", () => {
    const r = calculateTotals(base({ lines: [spaghetti(3)] }));
    expect(r.subtotalPaisa).toBe(rupees(5580));
    expect(r.lines[0]!.lineTotalPaisa).toBe(rupees(5580));
  });

  it("sums multiple lines", () => {
    const r = calculateTotals(base({ lines: [spaghetti(1), chai(2)] }));
    expect(r.subtotalPaisa).toBe(rupees(1860 + 760));
  });

  it("returns zero for an empty cart without throwing", () => {
    const r = calculateTotals(base({ lines: [] }));
    expect(r.subtotalPaisa).toBe(0);
    expect(r.taxPaisa).toBe(0);
    expect(r.totalPaisa).toBe(0);
  });

  it("handles a single item of quantity one", () => {
    const r = calculateTotals(base({ lines: [chai()] }));
    expect(r.subtotalPaisa).toBe(rupees(380));
    expect(r.totalPaisa).toBe(rupees(380) + rupees(57)); // +15%
  });
});

describe("modifiers", () => {
  it("adds positive deltas to the unit price before multiplying", () => {
    const r = calculateTotals(
      base({
        lines: [
          spaghetti(2, [
            { id: "m1", name: "Extra chicken", priceDeltaPaisa: rupees(350) },
          ]),
        ],
      }),
    );
    expect(r.lines[0]!.unitTotalPaisa).toBe(rupees(2210));
    expect(r.subtotalPaisa).toBe(rupees(4420)); // not 1860*2 + 350
  });

  it("applies negative deltas", () => {
    const r = calculateTotals(
      base({
        lines: [
          spaghetti(1, [
            { id: "m2", name: "No parmesan", priceDeltaPaisa: -rupees(60) },
          ]),
        ],
      }),
    );
    expect(r.subtotalPaisa).toBe(rupees(1800));
  });

  it("never lets modifiers drive a line below zero", () => {
    const absurd: PricedLine = {
      ...chai(1),
      modifiers: [{ id: "m3", name: "Absurd", priceDeltaPaisa: -rupees(9999) }],
    };
    const r = calculateTotals(base({ lines: [absurd] }));
    expect(r.subtotalPaisa).toBe(0);
    expect(r.totalPaisa).toBe(0);
  });

  it("sums several modifiers on one line", () => {
    const r = calculateTotals(
      base({
        lines: [
          spaghetti(1, [
            { id: "a", name: "Extra cheese", priceDeltaPaisa: rupees(150) },
            { id: "b", name: "Add fries", priceDeltaPaisa: rupees(290) },
          ]),
        ],
      }),
    );
    expect(r.subtotalPaisa).toBe(rupees(2300));
  });
});

describe("discounts", () => {
  it("applies a percentage discount before tax", () => {
    const r = calculateTotals(
      base({ discount: { kind: "percentage", label: "10% off", percent: 10 } }),
    );
    expect(r.discountPaisa).toBe(rupees(186));
    expect(r.taxablePaisa).toBe(rupees(1674));
    expect(r.taxPaisa).toBe(rupees(251.1)); // 1674 * 0.15
    expect(r.totalPaisa).toBe(rupees(1674) + rupees(251.1));
  });

  it("applies a fixed discount", () => {
    const r = calculateTotals(
      base({ discount: { kind: "fixed", label: "Rs. 200 off", amountPaisa: rupees(200) } }),
    );
    expect(r.discountPaisa).toBe(rupees(200));
    expect(r.taxablePaisa).toBe(rupees(1660));
  });

  it("never discounts more than the subtotal — no credit balances", () => {
    const r = calculateTotals(
      base({
        lines: [chai()],
        discount: { kind: "fixed", label: "Huge", amountPaisa: rupees(5000) },
      }),
    );
    expect(r.discountPaisa).toBe(rupees(380));
    expect(r.taxablePaisa).toBe(0);
    expect(r.totalPaisa).toBe(0);
  });

  it("caps a percentage discount at 100%", () => {
    const r = calculateTotals(
      base({ discount: { kind: "percentage", label: "Broken", percent: 250 } }),
    );
    expect(r.discountPaisa).toBe(rupees(1860));
    expect(r.totalPaisa).toBe(0);
  });

  it("ignores non-positive percentages", () => {
    for (const percent of [0, -10]) {
      const r = calculateTotals(
        base({ discount: { kind: "percentage", label: "x", percent } }),
      );
      expect(r.discountPaisa).toBe(0);
      expect(r.discountLabel).toBeNull();
    }
  });

  it("labels the discount only when one actually applied", () => {
    expect(calculateTotals(base()).discountLabel).toBeNull();
    expect(
      calculateTotals(
        base({ discount: { kind: "percentage", label: "10% off", percent: 10 } }),
      ).discountLabel,
    ).toBe("10% off");
  });
});

describe("delivery", () => {
  const delivery = { feePaisa: rupees(149), minOrderPaisa: rupees(800) };

  it("adds the fee after tax — the fee is logistics, not restaurant service", () => {
    const r = calculateTotals(base({ orderType: "DELIVERY", delivery }));
    expect(r.deliveryFeePaisa).toBe(rupees(149));
    expect(r.taxPaisa).toBe(rupees(279)); // taxed on 1860, not on 2009
    expect(r.totalPaisa).toBe(rupees(1860) + rupees(279) + rupees(149));
  });

  it("charges no delivery fee for takeaway or dine-in", () => {
    for (const orderType of ["TAKEAWAY", "DINE_IN"] as const) {
      const r = calculateTotals(base({ orderType, delivery }));
      expect(r.deliveryFeePaisa).toBe(0);
    }
  });

  it("flags an order below the zone minimum, with the shortfall", () => {
    const r = calculateTotals(base({ lines: [chai()], orderType: "DELIVERY", delivery }));
    expect(r.belowMinimum).toEqual({
      minOrderPaisa: rupees(800),
      shortfallPaisa: rupees(420),
    });
  });

  it("does not flag an order exactly at the minimum", () => {
    const atMin: PricedLine = { ...chai(), unitPricePaisa: rupees(800) };
    const r = calculateTotals(base({ lines: [atMin], orderType: "DELIVERY", delivery }));
    expect(r.belowMinimum).toBeNull();
  });

  it("never flags a minimum for non-delivery orders", () => {
    const r = calculateTotals(base({ lines: [chai()], orderType: "TAKEAWAY", delivery }));
    expect(r.belowMinimum).toBeNull();
  });

  it("throws if a delivery order has no terms", () => {
    expect(() => calculateTotals(base({ orderType: "DELIVERY" }))).toThrow(PricingError);
  });
});

describe("rounding", () => {
  it("returns integer paisa for every field", () => {
    // 8% of 777 rupees = 62.16 rupees = 6216 paisa exactly; use an odd
    // amount that does not divide cleanly to force a rounding decision.
    const odd: PricedLine = { ...chai(), unitPricePaisa: 77733 };
    const r = calculateTotals(base({ lines: [odd], paymentMethod: "ONLINE" }));

    for (const [key, value] of Object.entries(r)) {
      if (typeof value === "number") {
        expect(Number.isInteger(value), `${key} = ${value} is not an integer`).toBe(true);
      }
    }
    expect(Number.isInteger(r.totalPaisa)).toBe(true);
  });

  it("rounds a half-paisa away from zero rather than always up", () => {
    // 12.5 paisa of tax: 156.25 paisa at 8% -> exercise the .5 boundary.
    const line: PricedLine = { ...chai(), unitPricePaisa: 6250 };
    const r = calculateTotals(base({ lines: [line], paymentMethod: "ONLINE" }));
    expect(r.taxPaisa).toBe(500); // 6250 * 800 / 10000 = 500 exactly
  });

  it("keeps the total equal to taxable + tax + delivery, always", () => {
    const delivery = { feePaisa: rupees(199), minOrderPaisa: 0 };
    for (const price of [1, 7, 333, 99999, 123457]) {
      for (const method of ["CASH", "ONLINE"] as const) {
        const line: PricedLine = { ...chai(), unitPricePaisa: price };
        const r = calculateTotals({
          lines: [line],
          orderType: "DELIVERY",
          paymentMethod: method,
          delivery,
        });
        expect(r.totalPaisa).toBe(r.taxablePaisa + r.taxPaisa + r.deliveryFeePaisa);
      }
    }
  });
});

describe("input validation", () => {
  it("rejects a zero or negative quantity", () => {
    for (const quantity of [0, -1]) {
      expect(() => calculateTotals(base({ lines: [spaghetti(quantity)] }))).toThrow(
        PricingError,
      );
    }
  });

  it("rejects a fractional quantity", () => {
    expect(() => calculateTotals(base({ lines: [spaghetti(1.5)] }))).toThrow(PricingError);
  });

  it("rejects a fractional price — floats must never reach the engine", () => {
    const bad: PricedLine = { ...chai(), unitPricePaisa: 380.5 };
    expect(() => calculateTotals(base({ lines: [bad] }))).toThrow(PricingError);
  });

  it("rejects a negative price", () => {
    const bad: PricedLine = { ...chai(), unitPricePaisa: -100 };
    expect(() => calculateTotals(base({ lines: [bad] }))).toThrow(PricingError);
  });

  it("rejects a fractional modifier delta", () => {
    const bad = spaghetti(1, [{ id: "m", name: "Odd", priceDeltaPaisa: 10.5 }]);
    expect(() => calculateTotals(base({ lines: [bad] }))).toThrow(PricingError);
  });
});
