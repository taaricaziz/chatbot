import "server-only";
import { randomBytes } from "node:crypto";
import {
  assertBookableDate,
  AvailabilityError,
  buildAvailability,
  findTableForSlot,
  suggestAlternatives,
  type Seating,
  type Slot,
} from "@/lib/services/availability";
import {
  getBookingsForDate,
  getTableInventory,
  saveReservation,
  findReservationByReference,
  type StoredReservation,
} from "@/lib/repositories/reservations";
import { normalisePhone } from "@/lib/services/orders";
import { enqueue } from "@/lib/repositories/notifications";

/**
 * Reservations.
 *
 * The availability maths lives in services/availability.ts and is pure. This
 * module is the shell: it fetches inventory and bookings, calls that, and
 * writes the result.
 */

export class ReservationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_DATE"
      | "INVALID_PARTY"
      | "INVALID_CUSTOMER"
      | "SLOT_TAKEN"
      | "NOT_CONFIRMED"
      | "NOT_FOUND",
    readonly alternatives: Slot[] = [],
  ) {
    super(message);
  }
}

export interface AvailabilityQuery {
  date: string;
  partySize: number;
  seating: Seating;
}

export async function getAvailability(query: AvailabilityQuery, now = new Date()) {
  try {
    assertBookableDate(query.date, now);
  } catch (error) {
    if (error instanceof AvailabilityError) {
      throw new ReservationError(error.message, "INVALID_DATE");
    }
    throw error;
  }

  const [tables, bookings] = await Promise.all([
    getTableInventory(),
    getBookingsForDate(query.date),
  ]);

  let slots: Slot[];
  try {
    slots = buildAvailability(tables, bookings, { ...query, now });
  } catch (error) {
    if (error instanceof AvailabilityError) {
      throw new ReservationError(error.message, "INVALID_PARTY");
    }
    throw error;
  }

  return {
    date: query.date,
    partySize: query.partySize,
    seating: query.seating,
    slots,
    anyAvailable: slots.some((s) => s.available),
  };
}

/**
 * Reference codes people read aloud over the phone.
 * Ambiguous characters (0/O, 1/I/L) are excluded.
 */
function generateReference(): string {
  const alphabet = "ACDEFGHJKMNPQRTUVWXY3456789";
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `GR-${out.slice(0, 3)}-${out.slice(3, 6)}`;
}

export interface CreateReservationRequest {
  date: string;
  startsAt: string;
  partySize: number;
  seating: Seating;
  name: string;
  phone: string;
  email?: string;
  occasion?: string;
  requests?: string;
  /** Same rule as orders: nothing is booked without an explicit act. */
  confirmed: boolean;
  idempotencyKey?: string;
}

export async function createReservation(
  request: CreateReservationRequest,
  now = new Date(),
): Promise<StoredReservation> {
  if (request.confirmed !== true) {
    throw new ReservationError(
      "This booking has not been confirmed. Nothing was saved.",
      "NOT_CONFIRMED",
    );
  }

  const name = request.name?.trim();
  if (!name || name.length < 2) {
    throw new ReservationError("A name is required to book a table.", "INVALID_CUSTOMER");
  }

  const phone = normalisePhone(request.phone ?? "");
  if (!phone) {
    throw new ReservationError(
      "A valid Pakistani mobile number is required (e.g. 0300 1234567).",
      "INVALID_CUSTOMER",
    );
  }

  try {
    assertBookableDate(request.date, now);
  } catch (error) {
    if (error instanceof AvailabilityError) {
      throw new ReservationError(error.message, "INVALID_DATE");
    }
    throw error;
  }

  const [tables, bookings] = await Promise.all([
    getTableInventory(),
    getBookingsForDate(request.date),
  ]);

  const slotStart = new Date(request.startsAt);
  if (Number.isNaN(slotStart.getTime())) {
    throw new ReservationError("That time is not valid.", "INVALID_DATE");
  }

  // Re-check availability at write time. The customer may have been looking
  // at the form for ten minutes while somebody else took the table.
  const table = findTableForSlot(
    tables,
    bookings,
    slotStart,
    request.partySize,
    request.seating,
  );

  if (!table) {
    const all = buildAvailability(tables, bookings, {
      date: request.date,
      partySize: request.partySize,
      seating: request.seating,
      now,
    });
    throw new ReservationError(
      "That table was taken while you were booking. Here are the nearest times still free.",
      "SLOT_TAKEN",
      suggestAlternatives(all, request.startsAt),
    );
  }

  const endsAt = new Date(slotStart.getTime() + table.turnMinutes * 60_000);

  const reservation: StoredReservation = {
    id: crypto.randomUUID(),
    reference: generateReference(),
    tableId: table.id,
    tableLabel: table.label,
    guestName: name,
    guestPhone: phone,
    guestEmail: request.email?.trim() || null,
    partySize: request.partySize,
    startsAt: slotStart.toISOString(),
    endsAt: endsAt.toISOString(),
    seating: request.seating,
    // PENDING, not CONFIRMED: the café approves bookings. Telling a guest
    // their table is confirmed before a human has seen it is a promise the
    // system cannot keep.
    status: "PENDING",
    occasion: request.occasion?.trim() || null,
    requests: request.requests?.trim() || null,
    createdAt: now.toISOString(),
  };

  try {
    await saveReservation(reservation);
  } catch {
    // The database exclusion constraint rejected it — someone booked that
    // exact table-and-time in the moments since the check above.
    const all = buildAvailability(tables, bookings, {
      date: request.date,
      partySize: request.partySize,
      seating: request.seating,
      now,
    });
    throw new ReservationError(
      "That table was booked a moment before yours. Here are the nearest times still free.",
      "SLOT_TAKEN",
      suggestAlternatives(all, request.startsAt),
    );
  }

  await enqueue({
    channel: "SMS",
    template: "RESERVATION_RECEIVED",
    recipient: phone,
    dedupeKey: `reservation:${reservation.reference}:RESERVATION_RECEIVED`,
    reservationId: reservation.id,
    payload: {
      reference: reservation.reference,
      partySize: reservation.partySize,
      whenText: slotStart.toLocaleString("en-PK", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  });

  return reservation;
}

export async function getReservation(
  reference: string,
): Promise<StoredReservation | null> {
  return findReservationByReference(reference);
}
