import "server-only";
import { randomBytes } from "node:crypto";
import { quoteCart, CartError, type CartLineRef } from "@/lib/services/cart";
import type { OrderType, PaymentMethod } from "@/lib/services/pricing";
import { getOrderStore } from "@/lib/repositories/orders";
import { enqueue } from "@/lib/repositories/notifications";

/**
 * Order creation.
 *
 * Four rules are enforced here and nowhere else:
 *
 *  1. The client never sets a price. The cart is re-quoted from the menu
 *     before anything is written, so the order total is derived, not accepted.
 *  2. The total the customer SAW must match the total we compute. If it does
 *     not, the order is rejected rather than silently charged at a different
 *     price — a price that changed between the summary screen and the button
 *     press is exactly the case a customer would dispute.
 *  3. Nothing is confirmed without an explicit act. `confirmed: true` must be
 *     present; a draft never reaches the kitchen.
 *  4. Retries are idempotent. Agents retry, and phones on Karachi mobile data
 *     retry. One retried request must not become two dinners.
 */

export interface CustomerDetails {
  name: string;
  phone: string;
  email?: string;
}

export interface DeliveryDetails {
  address: string;
  area?: string;
  landmark?: string;
  instructions?: string;
}

export interface CreateOrderRequest {
  lines: CartLineRef[];
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  customer: CustomerDetails;
  delivery?: DeliveryDetails;
  notes?: string;
  /** The customer must explicitly confirm. Absent or false is a refusal. */
  confirmed: boolean;
  /** The total shown on the summary screen, for the mismatch check. */
  expectedTotalPaisa?: number;
  idempotencyKey?: string;
  source?: "WEB" | "AGENT_CHAT" | "AGENT_SMS" | "AGENT_WHATSAPP" | "ADMIN" | "PHONE";
  /** Required for DINE_IN: the open session this round belongs to. */
  tableSessionId?: string;
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  status: string;
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  customerName: string;
  /// Normalised (+92…). Null for dine-in, which has no customer record.
  customerPhone: string | null;
  subtotalPaisa: number;
  discountPaisa: number;
  taxRateBp: number;
  taxPaisa: number;
  deliveryFeePaisa: number;
  totalPaisa: number;
  confirmedAt: string;
  createdAt: string;
  items: {
    name: string;
    quantity: number;
    unitPricePaisa: number;
    lineTotalPaisa: number;
  }[];
  delivery: DeliveryDetails | null;
  notes: string | null;
  /** Set for dine-in rounds; null otherwise. */
  tableSessionId?: string | null;
}

export class OrderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_CONFIRMED"
      | "EMPTY_CART"
      | "UNAVAILABLE_ITEMS"
      | "UNKNOWN_ITEMS"
      | "INVALID_CART"
      | "TOTAL_MISMATCH"
      | "MISSING_DELIVERY"
      | "BELOW_MINIMUM"
      | "OUT_OF_AREA"
      | "INVALID_CUSTOMER"
      | "MISSING_SESSION",
  ) {
    super(message);
  }
}

/**
 * Human-readable, non-sequential order number.
 *
 * Sequential numbers leak volume (a competitor can count your orders) and
 * invite enumeration. Ambiguous characters are excluded so it can be read
 * aloud over a phone without confusion.
 */
function generateOrderNumber(): string {
  const alphabet = "ACDEFGHJKLMNPQRTUVWXY3456789";
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `GC-${out.slice(0, 3)}-${out.slice(3, 6)}`;
}

const PHONE_RE = /^(?:\+92|0)?3\d{9}$/;

/** Normalises a Pakistani mobile number to +92XXXXXXXXXX. */
export function normalisePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s-()]/g, "");
  if (!PHONE_RE.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+92/, "").replace(/^0/, "");
  return `+92${digits}`;
}

export async function createOrder(
  request: CreateOrderRequest,
): Promise<CreatedOrder> {
  // ---- Rule 3: explicit confirmation, checked before anything else ----
  if (request.confirmed !== true) {
    throw new OrderError(
      "This order has not been confirmed. Nothing was saved.",
      "NOT_CONFIRMED",
    );
  }

  if (request.lines.length === 0) {
    throw new OrderError("Cannot place an order with an empty cart.", "EMPTY_CART");
  }

  // Dine-in is deliberately exempt from customer details: at a table the
  // waiter is right there, so name and phone are friction with no purpose.
  const isDineIn = request.orderType === "DINE_IN";

  let name = request.customer?.name?.trim() ?? "";
  let phone: string | null = null;

  if (isDineIn) {
    if (!request.tableSessionId) {
      throw new OrderError(
        "A dine-in order must belong to an open table session.",
        "MISSING_SESSION",
      );
    }
    if (!name) name = "Table order";
  } else {
    if (!name || name.length < 2) {
      throw new OrderError("A name is required to place an order.", "INVALID_CUSTOMER");
    }
    phone = normalisePhone(request.customer.phone ?? "");
    if (!phone) {
      throw new OrderError(
        "A valid Pakistani mobile number is required (e.g. 0300 1234567).",
        "INVALID_CUSTOMER",
      );
    }
  }

  if (request.orderType === "DELIVERY" && !request.delivery?.address?.trim()) {
    throw new OrderError(
      "A delivery address is required for delivery orders.",
      "MISSING_DELIVERY",
    );
  }

  const store = getOrderStore();

  // ---- Rule 4: idempotency, checked before any write ----
  if (request.idempotencyKey) {
    const existing = await store.findByIdempotencyKey(request.idempotencyKey);
    if (existing) return existing;
  }

  // ---- Rule 1: re-price from the menu. Client prices are never trusted ----
  let quote;
  try {
    quote = await quoteCart({
      lines: request.lines,
      orderType: request.orderType,
      paymentMethod: request.paymentMethod,
      ...(request.delivery
        ? {
            deliveryAddress: request.delivery.address,
            ...(request.delivery.area ? { deliveryArea: request.delivery.area } : {}),
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof CartError) {
      // Do not label every cart failure as an unknown item — a quantity cap
      // or a missing delivery term is a different problem, and telling the
      // customer their sandwich no longer exists would be a lie.
      throw new OrderError(error.message, "INVALID_CART");
    }
    throw error;
  }

  if (quote.unknownSlugs.length > 0) {
    throw new OrderError(
      `These items are no longer on the menu: ${quote.unknownSlugs.join(", ")}.`,
      "UNKNOWN_ITEMS",
    );
  }

  if (quote.unavailableSlugs.length > 0) {
    throw new OrderError(
      `These items are unavailable today: ${quote.unavailableSlugs.join(", ")}.`,
      "UNAVAILABLE_ITEMS",
    );
  }

  // An address we do not cover must never become a silent free delivery.
  if (request.orderType === "DELIVERY" && quote.delivery && !quote.delivery.covered) {
    throw new OrderError(
      "We do not deliver to that address yet. Takeaway is available, or call the café to check.",
      "OUT_OF_AREA",
    );
  }

  if (quote.breakdown.belowMinimum) {
    const min = quote.breakdown.belowMinimum;
    throw new OrderError(
      `Delivery to ${quote.delivery?.zoneName ?? "that area"} starts at ` +
        `Rs. ${Math.round(min.minOrderPaisa / 100).toLocaleString("en-PK")}. ` +
        `Add Rs. ${Math.round(min.shortfallPaisa / 100).toLocaleString("en-PK")} more to continue.`,
      "BELOW_MINIMUM",
    );
  }

  // ---- Rule 2: what they saw must equal what we computed ----
  if (
    typeof request.expectedTotalPaisa === "number" &&
    request.expectedTotalPaisa !== quote.breakdown.totalPaisa
  ) {
    throw new OrderError(
      "Prices changed while you were ordering. Please review your cart and try again.",
      "TOTAL_MISMATCH",
    );
  }

  const now = new Date().toISOString();

  const order: CreatedOrder = {
    id: crypto.randomUUID(),
    orderNumber: generateOrderNumber(),
    status: "CONFIRMED",
    orderType: request.orderType,
    paymentMethod: request.paymentMethod,
    customerName: name,
    customerPhone: phone,
    subtotalPaisa: quote.breakdown.subtotalPaisa,
    discountPaisa: quote.breakdown.discountPaisa,
    taxRateBp: quote.breakdown.taxRateBp,
    taxPaisa: quote.breakdown.taxPaisa,
    deliveryFeePaisa: quote.breakdown.deliveryFeePaisa,
    totalPaisa: quote.breakdown.totalPaisa,
    confirmedAt: now,
    createdAt: now,
    // Snapshots, not references — a later menu edit must not rewrite this.
    items: quote.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPricePaisa: l.unitTotalPaisa,
      lineTotalPaisa: l.lineTotalPaisa,
    })),
    delivery: request.delivery ?? null,
    notes: request.notes?.trim() || null,
    tableSessionId: request.tableSessionId ?? null,
  };

  await store.save(order, {
    phone,
    tableSessionId: request.tableSessionId ?? null,
    email: request.customer.email?.trim() || null,
    idempotencyKey: request.idempotencyKey ?? null,
    source: request.source ?? "WEB",
  });

  // Queue the confirmation. Deliberately AFTER the order is saved and
  // deliberately not awaited for delivery: a provider outage must never fail
  // an order that the kitchen has already accepted. The worker sends it.
  //
  // Dine-in has no customer contact details, so there is nobody to notify —
  // the food arrives at the table.
  if (phone && request.orderType !== "DINE_IN") {
    await enqueue({
      channel: "SMS",
      template: "ORDER_CONFIRMED",
      recipient: phone,
      // Keyed on the order, so a retried POST that returns the existing order
      // cannot queue a second text.
      dedupeKey: `order:${order.orderNumber}:ORDER_CONFIRMED`,
      orderId: order.id,
      payload: {
        orderNumber: order.orderNumber,
        totalPaisa: order.totalPaisa,
        orderType: order.orderType,
        customerName: order.customerName,
      },
    });
  }

  return order;
}

export async function getOrder(idOrNumber: string): Promise<CreatedOrder | null> {
  return getOrderStore().findByIdOrNumber(idOrNumber);
}
