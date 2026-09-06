import { CAFE } from "@/lib/cafe";
import { formatPKR } from "@/lib/money";

/**
 * Notification templates.
 *
 * Pure: given a payload, produce a subject and a body. No I/O, no provider,
 * no clock — so every message a customer could receive is testable, and a
 * template can be checked for the things that actually go wrong (an
 * unreplaced placeholder, an SMS over one segment, a total that disagrees
 * with the order).
 */

export type Channel = "EMAIL" | "SMS" | "WHATSAPP";

export type TemplateId =
  | "ORDER_CONFIRMED"
  | "ORDER_READY"
  | "ORDER_OUT_FOR_DELIVERY"
  | "ORDER_CANCELLED"
  | "RESERVATION_RECEIVED"
  | "RESERVATION_CONFIRMED"
  | "RESERVATION_DECLINED";

export interface RenderedMessage {
  subject: string;
  body: string;
}

/** A single GSM-7 SMS segment. Longer messages are split and billed per part. */
export const SMS_SEGMENT_CHARS = 160;

export class TemplateError extends Error {}

function need(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (value === undefined || value === null || value === "") {
    throw new TemplateError(`Template needs "${key}" but it was missing.`);
  }
  return String(value);
}

function money(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TemplateError(`Template needs integer paisa for "${key}".`);
  }
  return formatPKR(value);
}

/**
 * Renders a message.
 *
 * SMS bodies are deliberately terse — every 160 characters is another billed
 * segment, and a café sending thousands of these a month notices. Email can
 * afford to be warmer.
 */
export function renderTemplate(
  template: TemplateId,
  channel: Channel,
  payload: Record<string, unknown>,
): RenderedMessage {
  const short = channel === "SMS";

  switch (template) {
    case "ORDER_CONFIRMED": {
      const number = need(payload, "orderNumber");
      const total = money(payload, "totalPaisa");
      const type = need(payload, "orderType");
      const collect = type === "DELIVERY" ? "on its way soon" : "ready for collection soon";

      return {
        subject: `Order ${number} confirmed`,
        body: short
          ? `${CAFE.name}: order ${number} confirmed, ${total}. We'll text when it's ${type === "DELIVERY" ? "on the way" : "ready"}.`
          : `Thanks — we've got your order.\n\n` +
            `Order ${number}\nTotal ${total}\n\n` +
            `It'll be ${collect}. If anything looks wrong, call us on ${CAFE.phoneDisplay} and quote ${number}.\n\n` +
            `${CAFE.name}\n${CAFE.address.line1}, ${CAFE.address.line2}`,
      };
    }

    case "ORDER_READY": {
      const number = need(payload, "orderNumber");
      return {
        subject: `Order ${number} is ready`,
        body: short
          ? `${CAFE.name}: order ${number} is ready to collect.`
          : `Your order ${number} is ready to collect.\n\n` +
            `${CAFE.name}\n${CAFE.address.line1}, ${CAFE.address.line2}\n${CAFE.address.locality}`,
      };
    }

    case "ORDER_OUT_FOR_DELIVERY": {
      const number = need(payload, "orderNumber");
      const eta = payload.etaText ? ` Roughly ${String(payload.etaText)}.` : "";
      return {
        subject: `Order ${number} is on its way`,
        body: short
          ? `${CAFE.name}: order ${number} has left with the rider.${eta}`
          : `Your order ${number} has left with our rider.${eta}\n\n` +
            `It's an estimate — traffic decides the rest.`,
      };
    }

    case "ORDER_CANCELLED": {
      const number = need(payload, "orderNumber");
      return {
        subject: `Order ${number} cancelled`,
        body: short
          ? `${CAFE.name}: order ${number} has been cancelled. Call ${CAFE.phoneDisplay} if that's unexpected.`
          : `Your order ${number} has been cancelled.\n\n` +
            `If that's unexpected, call us on ${CAFE.phoneDisplay} and quote ${number}.`,
      };
    }

    case "RESERVATION_RECEIVED": {
      const ref = need(payload, "reference");
      const when = need(payload, "whenText");
      const party = need(payload, "partySize");
      return {
        subject: `Booking ${ref} received`,
        body: short
          ? `${CAFE.name}: booking ${ref} for ${party} on ${when} received. We'll confirm shortly.`
          : `We've got your booking request.\n\n` +
            `Reference ${ref}\n${when}\n${party} guests\n\n` +
            `We confirm bookings by hand, usually within a couple of hours — ` +
            `you'll get another message once it's held.`,
      };
    }

    case "RESERVATION_CONFIRMED": {
      const ref = need(payload, "reference");
      const when = need(payload, "whenText");
      const party = need(payload, "partySize");
      return {
        subject: `Booking ${ref} confirmed`,
        body: short
          ? `${CAFE.name}: booking ${ref} confirmed for ${party} on ${when}. Held 15 min past.`
          : `Your table is booked.\n\n` +
            `Reference ${ref}\n${when}\n${party} guests\n\n` +
            `We hold the table for 15 minutes past your time. To change it, ` +
            `call ${CAFE.phoneDisplay} and quote ${ref}.\n\n` +
            `${CAFE.name}\n${CAFE.address.line1}, ${CAFE.address.line2}`,
      };
    }

    case "RESERVATION_DECLINED": {
      const ref = need(payload, "reference");
      return {
        subject: `Booking ${ref} could not be confirmed`,
        body: short
          ? `${CAFE.name}: sorry, booking ${ref} couldn't be confirmed. Call ${CAFE.phoneDisplay} and we'll find you a time.`
          : `We're sorry — we couldn't hold that table.\n\n` +
            `Booking ${ref} has not been confirmed. Call us on ${CAFE.phoneDisplay} ` +
            `and we'll find you another time.`,
      };
    }
  }
}

/** How many SMS segments a body costs. Surfaced so nobody is surprised by a bill. */
export function smsSegments(body: string): number {
  return Math.max(1, Math.ceil(body.length / SMS_SEGMENT_CHARS));
}

/**
 * Exponential backoff with a ceiling: 1m, 4m, 9m, 16m, 25m…
 *
 * Quadratic rather than doubling, because a café's provider outages are
 * usually minutes not hours, and an order confirmation that arrives four
 * hours late is worse than useless.
 */
export function backoffMs(attempts: number): number {
  const minutes = Math.min(attempts * attempts, 30);
  return minutes * 60_000;
}

/** After this many failures a message is DEAD and a human should look. */
export const MAX_ATTEMPTS = 5;
