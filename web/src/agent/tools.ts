import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { formatPKR } from "@/lib/money";
import { CAFE } from "@/lib/cafe";
import { getMenu, getItemBySlug } from "@/lib/repositories/menu";
import { quoteCart, CartError } from "@/lib/services/cart";
import { createOrder, OrderError, getOrder } from "@/lib/services/orders";
import {
  getAvailability,
  createReservation,
  ReservationError,
} from "@/lib/services/reservations";
import type { OrderType, PaymentMethod } from "@/lib/services/pricing";

/**
 * The agent's tools.
 *
 * Every one is a thin wrapper over the SAME service the website calls — no
 * HTTP, no duplicated rules. That is the whole point of the service layer:
 * the agent cannot compute a different total from the checkout page, because
 * neither of them computes anything.
 *
 * The model proposes; these functions execute. In particular the model has
 * no tool that can save an order without `confirmed: true` reaching
 * `createOrder`, which refuses without it.
 */

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_menu",
    description:
      "Search the café menu. Returns real items with real prices. Use this " +
      "before mentioning ANY dish or price — never describe an item from " +
      "memory. Omit the query to list everything.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free text, e.g. 'chicken', 'coffee', 'vegetarian pasta'.",
        },
        category: { type: "string", description: "Exact category name." },
        vegetarianOnly: { type: "boolean" },
      },
    },
  },
  {
    name: "price_cart",
    description:
      "Prices a proposed cart WITHOUT ordering anything. Returns the " +
      "authoritative subtotal, tax and total. You must call this before " +
      "quoting any total, and you must repeat its numbers exactly — never " +
      "do arithmetic yourself.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Menu item slugs and quantities.",
          items: {
            type: "object",
            properties: {
              slug: { type: "string" },
              quantity: { type: "integer", minimum: 1, maximum: 20 },
            },
            required: ["slug", "quantity"],
          },
        },
        orderType: { type: "string", enum: ["TAKEAWAY", "DELIVERY"] },
        paymentMethod: {
          type: "string",
          enum: ["CASH", "CARD_ON_DELIVERY", "CARD_AT_COUNTER", "ONLINE"],
          description:
            "Affects tax: 15% on cash, 8% on card/wallet/QR in Sindh.",
        },
        deliveryAddress: {
          type: "string",
          description: "Required for DELIVERY, so the zone and fee can be resolved.",
        },
      },
      required: ["items", "orderType", "paymentMethod"],
    },
  },
  {
    name: "place_order",
    description:
      "Saves a CONFIRMED order. Only call this after the customer has seen a " +
      "full summary from price_cart and has explicitly agreed — a clear yes. " +
      "Vague replies like 'ok', 'sure' or 'maybe' are NOT agreement; ask " +
      "again. Calling this without real agreement is a serious error.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slug: { type: "string" },
              quantity: { type: "integer", minimum: 1, maximum: 20 },
            },
            required: ["slug", "quantity"],
          },
        },
        orderType: { type: "string", enum: ["TAKEAWAY", "DELIVERY"] },
        paymentMethod: {
          type: "string",
          enum: ["CASH", "CARD_ON_DELIVERY", "CARD_AT_COUNTER", "ONLINE"],
        },
        customerName: { type: "string" },
        customerPhone: {
          type: "string",
          description: "Pakistani mobile, e.g. 0300 1234567. Never invent one — ask.",
        },
        deliveryAddress: { type: "string" },
        notes: { type: "string" },
        customerSaidYes: {
          type: "boolean",
          description:
            "Set true ONLY if the customer's most recent message was an " +
            "unambiguous agreement to place this exact order.",
        },
      },
      required: [
        "items",
        "orderType",
        "paymentMethod",
        "customerName",
        "customerPhone",
        "customerSaidYes",
      ],
    },
  },
  {
    name: "check_order_status",
    description: "Looks up an existing order by its number, e.g. GC-ABC-123.",
    input_schema: {
      type: "object",
      properties: { orderNumber: { type: "string" } },
      required: ["orderNumber"],
    },
  },
  {
    name: "check_table_availability",
    description:
      "Real table availability for a date and party size. Use this before " +
      "offering any time — never guess what is free.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        partySize: { type: "integer", minimum: 1, maximum: 20 },
        seating: { type: "string", enum: ["INDOOR", "OUTDOOR", "ANY"] },
      },
      required: ["date", "partySize"],
    },
  },
  {
    name: "book_table",
    description:
      "Books a table. Same rule as place_order: only after the customer has " +
      "seen the details and explicitly agreed.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string" },
        startsAt: {
          type: "string",
          description: "The exact ISO timestamp from check_table_availability.",
        },
        partySize: { type: "integer", minimum: 1, maximum: 20 },
        seating: { type: "string", enum: ["INDOOR", "OUTDOOR", "ANY"] },
        guestName: { type: "string" },
        guestPhone: { type: "string" },
        occasion: { type: "string" },
        requests: { type: "string" },
        customerSaidYes: { type: "boolean" },
      },
      required: [
        "date",
        "startsAt",
        "partySize",
        "guestName",
        "guestPhone",
        "customerSaidYes",
      ],
    },
  },
  {
    name: "request_human",
    description:
      "Hand the conversation to a person. Use this when you genuinely cannot " +
      "help: a complaint, an allergy question you are not certain about, a " +
      "problem with an existing order, anything about payment disputes, or " +
      "any moment you would otherwise have to guess. Preferred over guessing " +
      "every single time.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Why a person is needed, in one line. Staff read this verbatim.",
        },
        customerContact: {
          type: "string",
          description: "Phone or name, if the customer has already given one.",
        },
      },
      required: ["reason"],
    },
  },
];

export interface ToolOutcome {
  ok: boolean;
  [key: string]: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function executeTool(
  name: string,
  input: any,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "search_menu": {
        const items = await getMenu({
          ...(input.query ? { query: String(input.query) } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.vegetarianOnly ? { vegetarianOnly: true } : {}),
        });
        // Token budget, not politeness: Groq's free tier allows 8,000
        // tokens PER MINUTE, and returning 25 full descriptions spent most
        // of one conversation's share on a single tool result. Measured, not
        // guessed — one early conversation used 6,866 of the 8,000.
        //
        // So: descriptions only when the list is short enough for them to be
        // read, and a nudge to search more narrowly when it is not.
        const shown = items.slice(0, 12);
        const detailed = shown.length <= 6;

        return {
          ok: true,
          count: items.length,
          ...(items.length > shown.length
            ? {
                note:
                  `Showing ${shown.length} of ${items.length}. Search more ` +
                  `narrowly for the rest.`,
              }
            : {}),
          items: shown.map((i) => ({
            slug: i.slug,
            name: i.name,
            category: i.category,
            price: formatPKR(i.price),
            ...(detailed ? { description: i.description } : {}),
            ...(i.isVegetarian ? { vegetarian: true } : {}),
            ...(i.isSpicy ? { spicy: true } : {}),
            // Only ever stated when it is FALSE: an item being available is
            // the assumption, and saying so on every line costs tokens to
            // convey nothing.
            ...(i.isAvailable ? {} : { available: false }),
          })),
        };
      }

      case "price_cart": {
        const quote = await quoteCart({
          lines: (input.items ?? []).map((i: any) => ({
            slug: String(i.slug),
            quantity: Number(i.quantity),
          })),
          orderType: input.orderType as OrderType,
          paymentMethod: input.paymentMethod as PaymentMethod,
          ...(input.deliveryAddress
            ? { deliveryAddress: String(input.deliveryAddress) }
            : {}),
        });

        if (quote.unknownSlugs.length > 0) {
          return {
            ok: false,
            error: "UNKNOWN_ITEMS",
            unknownSlugs: quote.unknownSlugs,
            message:
              "Those slugs are not on the menu. Use search_menu and use the " +
              "exact slug it returns.",
          };
        }

        const b = quote.breakdown;
        return {
          ok: true,
          // Pre-formatted so the model repeats a string rather than being
          // tempted to do arithmetic on numbers.
          lines: quote.lines.map((l) => ({
            name: l.name,
            quantity: l.quantity,
            lineTotal: formatPKR(l.lineTotalPaisa),
          })),
          subtotal: formatPKR(b.subtotalPaisa),
          taxRate: `${b.taxRateBp / 100}%`,
          tax: formatPKR(b.taxPaisa),
          deliveryFee: b.deliveryFeePaisa > 0 ? formatPKR(b.deliveryFeePaisa) : null,
          total: formatPKR(b.totalPaisa),
          unavailableItems: quote.unavailableSlugs,
          deliveryZone: quote.delivery?.zoneName ?? null,
          deliveryEta:
            quote.delivery?.etaMinMinutes != null
              ? `${quote.delivery.etaMinMinutes}–${quote.delivery.etaMaxMinutes} min (an estimate, not a promise)`
              : null,
          outOfDeliveryArea: quote.delivery ? !quote.delivery.covered : false,
          belowMinimum: b.belowMinimum
            ? `Minimum ${formatPKR(b.belowMinimum.minOrderPaisa)}; ` +
              `${formatPKR(b.belowMinimum.shortfallPaisa)} short`
            : null,
        };
      }

      case "place_order": {
        // The gate, enforced in code rather than trusted to the prompt. The
        // model must assert agreement, and createOrder independently requires
        // `confirmed`. Neither alone would be enough.
        if (input.customerSaidYes !== true) {
          return {
            ok: false,
            error: "NOT_CONFIRMED",
            message:
              "Refused: the customer has not clearly agreed. Show them the " +
              "summary and ask for a clear yes before calling this again.",
          };
        }

        const order = await createOrder({
          lines: (input.items ?? []).map((i: any) => ({
            slug: String(i.slug),
            quantity: Number(i.quantity),
          })),
          orderType: input.orderType as OrderType,
          paymentMethod: input.paymentMethod as PaymentMethod,
          customer: {
            name: String(input.customerName ?? ""),
            phone: String(input.customerPhone ?? ""),
          },
          ...(input.deliveryAddress
            ? { delivery: { address: String(input.deliveryAddress) } }
            : {}),
          ...(input.notes ? { notes: String(input.notes) } : {}),
          confirmed: true,
          source: "AGENT_CHAT",
        });

        return {
          ok: true,
          orderNumber: order.orderNumber,
          total: formatPKR(order.totalPaisa),
          status: order.status,
          message: `Order ${order.orderNumber} is placed.`,
        };
      }

      case "check_order_status": {
        const order = await getOrder(String(input.orderNumber));
        if (!order) return { ok: false, error: "NOT_FOUND", message: "No such order." };
        return {
          ok: true,
          orderNumber: order.orderNumber,
          status: order.status,
          orderType: order.orderType,
          total: formatPKR(order.totalPaisa),
          items: order.items.map((i) => `${i.quantity} × ${i.name}`),
        };
      }

      case "check_table_availability": {
        const result = await getAvailability({
          date: String(input.date),
          partySize: Number(input.partySize),
          seating: (input.seating ?? "ANY") as "INDOOR" | "OUTDOOR" | "ANY",
        });
        const free = result.slots.filter((s) => s.available);
        return {
          ok: true,
          date: result.date,
          anyAvailable: result.anyAvailable,
          availableTimes: free.map((s) => ({ time: s.label, startsAt: s.startsAt })),
          message: free.length
            ? `${free.length} times free.`
            : "Nothing free that day for that party size.",
        };
      }

      case "book_table": {
        if (input.customerSaidYes !== true) {
          return {
            ok: false,
            error: "NOT_CONFIRMED",
            message:
              "Refused: the customer has not clearly agreed to this booking.",
          };
        }

        const booking = await createReservation({
          date: String(input.date),
          startsAt: String(input.startsAt),
          partySize: Number(input.partySize),
          seating: (input.seating ?? "ANY") as "INDOOR" | "OUTDOOR" | "ANY",
          name: String(input.guestName ?? ""),
          phone: String(input.guestPhone ?? ""),
          ...(input.occasion ? { occasion: String(input.occasion) } : {}),
          ...(input.requests ? { requests: String(input.requests) } : {}),
          confirmed: true,
        });

        return {
          ok: true,
          reference: booking.reference,
          status: booking.status,
          message:
            `Booking ${booking.reference} received. It is PENDING until the ` +
            `café approves it — do not tell the guest it is confirmed.`,
        };
      }

      case "request_human": {
        // Nothing to execute — the point is the RECORD. The trace is what
        // flags the transcript for staff, so the tool succeeding IS the
        // escalation being filed.
        return {
          ok: true,
          escalated: true,
          message:
            "A person has been flagged to pick this up. Tell the customer " +
            "someone from the cafe will follow up, give them the phone " +
            `number ${CAFE.phoneDisplay}, and do not promise a time.`,
        };
      }

      default:
        return { ok: false, error: "UNKNOWN_TOOL", message: `No tool "${name}".` };
    }
  } catch (error) {
    // Service-layer refusals are information for the model, not crashes:
    // returned as a result so it can explain and recover.
    if (
      error instanceof OrderError ||
      error instanceof CartError ||
      error instanceof ReservationError
    ) {
      return {
        ok: false,
        error: "code" in error ? String(error.code) : "REFUSED",
        message: error.message,
        ...("alternatives" in error && Array.isArray((error as any).alternatives)
          ? {
              alternatives: (error as any).alternatives.map((a: any) => a.label),
            }
          : {}),
      };
    }
    console.error(`[agent] tool ${name} failed`, error);
    return { ok: false, error: "INTERNAL", message: "That did not work." };
  }
}

export { getItemBySlug };
