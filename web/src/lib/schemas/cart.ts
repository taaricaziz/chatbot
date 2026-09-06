import { z } from "zod";

/**
 * Boundary schemas. One definition, reused by the route handler, the client
 * forms, and (in Phase 12) the AI agent's generated tool definitions.
 *
 * Note what is NOT here: any price field. The client cannot send one, so it
 * cannot tamper with one.
 */

export const orderTypeSchema = z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]);

export const paymentMethodSchema = z.enum([
  "CASH",
  "CARD_ON_DELIVERY",
  "CARD_AT_COUNTER",
  "ONLINE",
]);

export const cartLineRefSchema = z.object({
  slug: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(20),
  modifierIds: z.array(z.uuid()).max(12).optional(),
});

export const quoteRequestSchema = z.object({
  lines: z.array(cartLineRefSchema).max(40),
  orderType: orderTypeSchema,
  paymentMethod: paymentMethodSchema,
  // Address drives zone lookup. Still no price field — the client says WHERE,
  // never HOW MUCH.
  deliveryAddress: z.string().trim().max(300).optional(),
  deliveryArea: z.string().trim().max(80).optional(),
});

export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;

// --------------------------------------------------------------- orders

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(20),
  email: z.email().max(120).optional().or(z.literal("")),
});

export const deliverySchema = z.object({
  address: z.string().trim().min(6).max(300),
  area: z.string().trim().max(80).optional(),
  landmark: z.string().trim().max(120).optional(),
  instructions: z.string().trim().max(300).optional(),
});

export const createOrderSchema = z.object({
  lines: z.array(cartLineRefSchema).min(1).max(40),
  orderType: orderTypeSchema,
  paymentMethod: paymentMethodSchema,
  // Dine-in rounds carry no customer details — see services/orders.ts.
  customer: customerSchema.partial().optional().default({}),
  tableSessionId: z.uuid().optional(),
  delivery: deliverySchema.optional(),
  notes: z.string().trim().max(400).optional(),
  /** Must be literally true — an unconfirmed order is a refusal, not a draft. */
  confirmed: z.literal(true),
  expectedTotalPaisa: z.number().int().min(0).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// --------------------------------------------------------- reservations

export const seatingSchema = z.enum(["INDOOR", "OUTDOOR", "ANY"]);

export const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  partySize: z.coerce.number().int().min(1).max(20),
  seating: seatingSchema.default("ANY"),
});

export const createReservationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startsAt: z.iso.datetime(),
  partySize: z.number().int().min(1).max(20),
  seating: seatingSchema.default("ANY"),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(20),
  email: z.email().max(120).optional().or(z.literal("")),
  occasion: z.string().trim().max(80).optional(),
  requests: z.string().trim().max(400).optional(),
  /** Must be literally true — an unconfirmed booking is a refusal. */
  confirmed: z.literal(true),
});
