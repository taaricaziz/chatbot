import type { Paisa } from "@/lib/money";

/**
 * The pricing engine. The only module in this codebase that computes money.
 *
 * It is deliberately pure: no database, no HTTP, no React. Prices are
 * resolved by the caller and passed in, so every rule here is testable
 * without booting a server — and so a Server Component, a route handler and
 * an AI agent tool all reach the same arithmetic.
 *
 * Everything is integer paisa. Rs. 1,860 is 186000.
 */

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";

export type PaymentMethod =
  | "CASH"
  | "CARD_ON_DELIVERY"
  | "CARD_AT_COUNTER"
  | "ONLINE";

/**
 * Sindh Revenue Board service sales tax, in basis points.
 *
 * 15% on cash, reduced to 8% when the customer pays by debit card, credit
 * card, mobile wallet or QR. This is the rule most restaurant builds get
 * wrong: the tax rate is a function of the payment method, so the grand
 * total CHANGES when the customer switches payment at checkout. On a
 * Rs. 4,000 order that is a Rs. 280 difference.
 *
 * Basis points rather than a float because the applied rate is stored on the
 * order row — rates change, and a six-month-old order must still reconcile
 * against what was actually charged.
 */
export const TAX_BP_CASH = 1500;
export const TAX_BP_DIGITAL = 800;

export function taxRateBpFor(method: PaymentMethod): number {
  return method === "CASH" ? TAX_BP_CASH : TAX_BP_DIGITAL;
}

/** A modifier as applied to one line — price already resolved. */
export interface AppliedModifier {
  id: string;
  name: string;
  priceDeltaPaisa: Paisa;
}

/** One cart line with server-resolved prices. */
export interface PricedLine {
  menuItemId: string;
  name: string;
  unitPricePaisa: Paisa;
  quantity: number;
  modifiers: AppliedModifier[];
}

export type Discount =
  | { kind: "none" }
  | { kind: "percentage"; label: string; percent: number }
  | { kind: "fixed"; label: string; amountPaisa: Paisa };

export interface DeliveryTerms {
  feePaisa: Paisa;
  minOrderPaisa: Paisa;
}

export interface PricingInput {
  lines: PricedLine[];
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  discount?: Discount;
  /** Required when orderType is DELIVERY. */
  delivery?: DeliveryTerms;
}

export interface LineBreakdown {
  menuItemId: string;
  name: string;
  quantity: number;
  /** Item price plus its modifiers, for one unit. */
  unitTotalPaisa: Paisa;
  lineTotalPaisa: Paisa;
}

export interface PriceBreakdown {
  lines: LineBreakdown[];
  subtotalPaisa: Paisa;
  discountPaisa: Paisa;
  discountLabel: string | null;
  taxablePaisa: Paisa;
  taxRateBp: number;
  taxPaisa: Paisa;
  deliveryFeePaisa: Paisa;
  totalPaisa: Paisa;
  /** Set when DELIVERY and the subtotal is under the zone minimum. */
  belowMinimum: { minOrderPaisa: Paisa; shortfallPaisa: Paisa } | null;
}

export class PricingError extends Error {}

/**
 * Rounds half away from zero.
 *
 * `Math.round` rounds half UP, so it treats -0.5 and 0.5 asymmetrically.
 * Discounts make negative intermediates reachable, and a receipt that is one
 * paisa out is a receipt a customer can argue with.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function assertValidLine(line: PricedLine): void {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new PricingError(
      `Quantity for "${line.name}" must be a positive integer, got ${line.quantity}.`,
    );
  }
  if (!Number.isInteger(line.unitPricePaisa) || line.unitPricePaisa < 0) {
    throw new PricingError(
      `Price for "${line.name}" must be a non-negative integer of paisa, got ${line.unitPricePaisa}.`,
    );
  }
  for (const m of line.modifiers) {
    if (!Number.isInteger(m.priceDeltaPaisa)) {
      throw new PricingError(
        `Modifier "${m.name}" price delta must be an integer of paisa, got ${m.priceDeltaPaisa}.`,
      );
    }
  }
}

/** One unit of a line: base price plus its modifier deltas, floored at zero. */
function unitTotal(line: PricedLine): Paisa {
  const deltas = line.modifiers.reduce((sum, m) => sum + m.priceDeltaPaisa, 0);
  // Modifier deltas may be negative ("no cheese"), but a line can never be
  // worth less than nothing.
  return Math.max(0, line.unitPricePaisa + deltas);
}

function computeDiscount(subtotal: Paisa, discount: Discount): Paisa {
  switch (discount.kind) {
    case "none":
      return 0;
    case "percentage": {
      if (discount.percent <= 0) return 0;
      const pct = Math.min(discount.percent, 100);
      return roundHalfAwayFromZero((subtotal * pct) / 100);
    }
    case "fixed":
      // Never exceeds the subtotal: a discount cannot create a credit.
      return Math.min(Math.max(0, discount.amountPaisa), subtotal);
  }
}

/**
 * The single source of truth for what an order costs.
 *
 * Order of operations matters and is fixed: discount comes off the subtotal,
 * tax applies to the discounted amount, and the delivery fee is added after
 * tax — the fee is a logistics charge, not part of the restaurant service
 * being taxed.
 */
export function calculateTotals(input: PricingInput): PriceBreakdown {
  const { lines, orderType, paymentMethod } = input;
  const discount = input.discount ?? { kind: "none" };

  lines.forEach(assertValidLine);

  if (orderType === "DELIVERY" && !input.delivery) {
    throw new PricingError(
      "Delivery orders require delivery terms (fee and minimum order).",
    );
  }

  const lineBreakdowns: LineBreakdown[] = lines.map((line) => {
    const unit = unitTotal(line);
    return {
      menuItemId: line.menuItemId,
      name: line.name,
      quantity: line.quantity,
      unitTotalPaisa: unit,
      lineTotalPaisa: unit * line.quantity,
    };
  });

  const subtotalPaisa = lineBreakdowns.reduce(
    (sum, l) => sum + l.lineTotalPaisa,
    0,
  );

  const discountPaisa = computeDiscount(subtotalPaisa, discount);
  const taxablePaisa = Math.max(0, subtotalPaisa - discountPaisa);

  const taxRateBp = taxRateBpFor(paymentMethod);
  const taxPaisa = roundHalfAwayFromZero((taxablePaisa * taxRateBp) / 10000);

  const deliveryFeePaisa =
    orderType === "DELIVERY" ? (input.delivery?.feePaisa ?? 0) : 0;

  const totalPaisa = taxablePaisa + taxPaisa + deliveryFeePaisa;

  let belowMinimum: PriceBreakdown["belowMinimum"] = null;
  if (orderType === "DELIVERY" && input.delivery) {
    const min = input.delivery.minOrderPaisa;
    if (subtotalPaisa < min) {
      belowMinimum = {
        minOrderPaisa: min,
        shortfallPaisa: min - subtotalPaisa,
      };
    }
  }

  return {
    lines: lineBreakdowns,
    subtotalPaisa,
    discountPaisa,
    discountLabel: discountPaisa > 0 && "label" in discount ? discount.label : null,
    taxablePaisa,
    taxRateBp,
    taxPaisa,
    deliveryFeePaisa,
    totalPaisa,
    belowMinimum,
  };
}

/**
 * What a customer would save (or pay extra) by switching payment method.
 *
 * Surfaced at checkout so the tax change is explained rather than appearing
 * as an unexplained total jump — a silent change of total destroys trust
 * faster than a higher one.
 */
export function taxDeltaBetweenMethods(
  input: PricingInput,
  from: PaymentMethod,
  to: PaymentMethod,
): Paisa {
  const a = calculateTotals({ ...input, paymentMethod: from });
  const b = calculateTotals({ ...input, paymentMethod: to });
  return b.totalPaisa - a.totalPaisa;
}
