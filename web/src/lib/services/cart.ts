import "server-only";
import { getItemBySlug } from "@/lib/repositories/menu";
import { getDeliveryZones } from "@/lib/repositories/delivery-zones";
import { quoteDelivery, type DeliveryQuote } from "@/lib/services/delivery";
import {
  calculateTotals,
  PricingError,
  type Discount,
  type DeliveryTerms,
  type OrderType,
  type PaymentMethod,
  type PriceBreakdown,
  type PricedLine,
} from "@/lib/services/pricing";

/**
 * Turns a cart of references into a priced quote.
 *
 * THE INVARIANT THIS MODULE EXISTS TO ENFORCE: the client sends item slugs,
 * quantities and modifier ids — never prices. Every price is re-read here
 * from the menu repository and the total recomputed. A tampered cart payload
 * changes nothing, because there is nothing in it to tamper with.
 *
 * Nothing is persisted. Quoting is a pure read; orders are created in
 * Phase 6, and only after explicit confirmation.
 */

/** What a client is allowed to send. Note the absence of any price field. */
export interface CartLineRef {
  slug: string;
  quantity: number;
  modifierIds?: string[];
}

export interface QuoteRequest {
  lines: CartLineRef[];
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  /** Explicit terms override zone lookup. Used by tests and the admin. */
  delivery?: DeliveryTerms;
  /** Address for zone lookup on DELIVERY orders. */
  deliveryAddress?: string;
  deliveryArea?: string;
  discount?: Discount;
}

export interface QuoteLine {
  slug: string;
  name: string;
  quantity: number;
  unitPricePaisa: number;
  unitTotalPaisa: number;
  lineTotalPaisa: number;
  isAvailable: boolean;
  modifiers: { id: string; name: string; priceDeltaPaisa: number }[];
}

export interface Quote {
  lines: QuoteLine[];
  breakdown: PriceBreakdown;
  /** Zone decision for DELIVERY orders; null otherwise. */
  delivery: DeliveryQuote | null;
  /** Slugs the client sent that no longer exist on the menu. */
  unknownSlugs: string[];
  /** Lines whose item is currently unavailable — checkout must block on these. */
  unavailableSlugs: string[];
}

export class CartError extends Error {}

const MAX_LINES = 40;
const MAX_QUANTITY_PER_LINE = 20;

export async function quoteCart(request: QuoteRequest): Promise<Quote> {
  if (request.lines.length > MAX_LINES) {
    throw new CartError(`A cart may hold at most ${MAX_LINES} distinct lines.`);
  }

  const unknownSlugs: string[] = [];
  const unavailableSlugs: string[] = [];
  const pricedLines: PricedLine[] = [];
  const quoteLines: QuoteLine[] = [];

  for (const ref of request.lines) {
    if (!Number.isInteger(ref.quantity) || ref.quantity < 1) {
      throw new CartError(
        `Quantity for "${ref.slug}" must be a positive whole number.`,
      );
    }
    if (ref.quantity > MAX_QUANTITY_PER_LINE) {
      throw new CartError(
        `Quantity for "${ref.slug}" exceeds the ${MAX_QUANTITY_PER_LINE} per-line limit. Call us for large orders.`,
      );
    }

    const item = await getItemBySlug(ref.slug);
    if (!item) {
      unknownSlugs.push(ref.slug);
      continue;
    }
    if (!item.isAvailable) unavailableSlugs.push(ref.slug);

    // Modifiers are not yet seeded; resolving them lands with the item
    // customisation UI. Until then an empty list keeps the shape stable.
    const modifiers: PricedLine["modifiers"] = [];

    const line: PricedLine = {
      menuItemId: item.id,
      name: item.name,
      unitPricePaisa: item.price,
      quantity: ref.quantity,
      modifiers,
    };
    pricedLines.push(line);

    const unitTotal =
      item.price + modifiers.reduce((s, m) => s + m.priceDeltaPaisa, 0);

    quoteLines.push({
      slug: item.slug,
      name: item.name,
      quantity: ref.quantity,
      unitPricePaisa: item.price,
      unitTotalPaisa: Math.max(0, unitTotal),
      lineTotalPaisa: Math.max(0, unitTotal) * ref.quantity,
      isAvailable: item.isAvailable,
      modifiers: modifiers.map((m) => ({
        id: m.id,
        name: m.name,
        priceDeltaPaisa: m.priceDeltaPaisa,
      })),
    });
  }

  // Resolve the delivery zone from the address before pricing. The fee and
  // minimum are properties of WHERE the food is going, so they cannot come
  // from the client.
  let deliveryQuote: DeliveryQuote | null = null;
  let terms: DeliveryTerms | undefined = request.delivery;

  if (request.orderType === "DELIVERY" && !terms) {
    const subtotal = quoteLines.reduce((sum, l) => sum + l.lineTotalPaisa, 0);
    const zones = await getDeliveryZones();
    deliveryQuote = quoteDelivery(
      zones,
      request.deliveryAddress ?? "",
      subtotal,
      request.deliveryArea,
    );

    if (!deliveryQuote.covered) {
      // Out of area: quote zero rather than invent a fee. Checkout blocks on
      // `covered` being false, so this never becomes a silent free delivery.
      terms = { feePaisa: 0, minOrderPaisa: 0 };
    } else {
      terms = {
        feePaisa: deliveryQuote.feePaisa,
        minOrderPaisa: deliveryQuote.minOrderPaisa,
      };
    }
  }

  let breakdown: PriceBreakdown;
  try {
    breakdown = calculateTotals({
      lines: pricedLines,
      orderType: request.orderType,
      paymentMethod: request.paymentMethod,
      ...(request.orderType === "DELIVERY" && terms ? { delivery: terms } : {}),
      ...(request.discount ? { discount: request.discount } : {}),
    });
  } catch (error) {
    if (error instanceof PricingError) throw new CartError(error.message);
    throw error;
  }

  return {
    lines: quoteLines,
    breakdown,
    delivery: deliveryQuote,
    unknownSlugs,
    unavailableSlugs,
  };
}
