/**
 * Reservation availability.
 *
 * Pure: it takes table inventory and existing bookings and returns what is
 * free. No database, no clock of its own — the caller passes `now` — so every
 * edge case here is testable without a server.
 *
 * "Show available times" is easy to fake with a fixed list of slots. That
 * shortcut produces double-bookings, so this works against real table
 * inventory and real overlap.
 */

export type Seating = "INDOOR" | "OUTDOOR" | "ANY";

export interface TableInventory {
  id: string;
  label: string;
  capacity: number;
  seating: "INDOOR" | "OUTDOOR";
  isActive: boolean;
  turnMinutes: number;
}

export interface ExistingBooking {
  tableId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface AvailabilityRequest {
  /** Local date, YYYY-MM-DD. */
  date: string;
  partySize: number;
  seating: Seating;
  now: Date;
}

export interface Slot {
  /** ISO timestamp of the slot start. */
  startsAt: string;
  /** "19:30" for display. */
  label: string;
  available: boolean;
  /** The smallest adequate table, when one is free. */
  tableId: string | null;
  tableLabel: string | null;
}

/** Service hours. Last booking starts well before close so the party can eat. */
export const FIRST_SLOT_HOUR = 12;
export const LAST_SLOT_HOUR = 22;
export const SLOT_STEP_MINUTES = 30;

/** How far ahead a booking can be made. */
export const MAX_DAYS_AHEAD = 60;

/** Bookings must be at least this far in the future. */
export const MIN_LEAD_MINUTES = 45;

export class AvailabilityError extends Error {}

/** Builds every candidate slot for a date, in local wall-clock terms. */
function slotTimes(date: string): Date[] {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) throw new AvailabilityError(`Invalid date: ${date}`);

  const out: Date[] = [];
  for (let hour = FIRST_SLOT_HOUR; hour <= LAST_SLOT_HOUR; hour++) {
    for (let min = 0; min < 60; min += SLOT_STEP_MINUTES) {
      if (hour === LAST_SLOT_HOUR && min > 0) break;
      out.push(new Date(y, m - 1, d, hour, min, 0, 0));
    }
  }
  return out;
}

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  // Half-open [start, end): a booking ending exactly when another begins does
  // NOT overlap, so back-to-back sittings are allowed.
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Picks the smallest adequate free table for one slot.
 *
 * Smallest-first matters in a real dining room: seating a couple at the
 * six-top because it happened to be first in the list burns the table you
 * need for the next group of six.
 */
export function findTableForSlot(
  tables: TableInventory[],
  bookings: ExistingBooking[],
  slotStart: Date,
  partySize: number,
  seating: Seating,
): TableInventory | null {
  const candidates = tables
    .filter((t) => t.isActive)
    .filter((t) => t.capacity >= partySize)
    .filter((t) => seating === "ANY" || t.seating === seating)
    .sort((a, b) => {
      // 1. Smallest adequate table first.
      if (a.capacity !== b.capacity) return a.capacity - b.capacity;

      // 2. On a tie, indoor before outdoor when the guest said "ANY".
      //    The terrace is the table people ask for by name, and a Karachi
      //    afternoon is not somewhere to seat someone who had no preference —
      //    so it is held back for guests who actually chose it.
      if (seating === "ANY" && a.seating !== b.seating) {
        return a.seating === "INDOOR" ? -1 : 1;
      }

      // 3. Stable, predictable order so the same request always seats the
      //    same table.
      return a.label.localeCompare(b.label);
    });

  for (const table of candidates) {
    const slotEnd = new Date(slotStart.getTime() + table.turnMinutes * 60_000);
    const clash = bookings.some(
      (b) =>
        b.tableId === table.id &&
        overlaps(slotStart, slotEnd, b.startsAt, b.endsAt),
    );
    if (!clash) return table;
  }
  return null;
}

export function buildAvailability(
  tables: TableInventory[],
  bookings: ExistingBooking[],
  request: AvailabilityRequest,
): Slot[] {
  if (request.partySize < 1 || request.partySize > 20) {
    throw new AvailabilityError(
      "Party size must be between 1 and 20. For larger groups, call the café.",
    );
  }

  const earliest = new Date(
    request.now.getTime() + MIN_LEAD_MINUTES * 60_000,
  );

  return slotTimes(request.date).map((slotStart) => {
    const label = `${String(slotStart.getHours()).padStart(2, "0")}:${String(
      slotStart.getMinutes(),
    ).padStart(2, "0")}`;

    // A slot in the past, or too soon, is never offered — the kitchen needs
    // notice and nobody can book yesterday.
    if (slotStart < earliest) {
      return { startsAt: slotStart.toISOString(), label, available: false, tableId: null, tableLabel: null };
    }

    const table = findTableForSlot(
      tables,
      bookings,
      slotStart,
      request.partySize,
      request.seating,
    );

    return {
      startsAt: slotStart.toISOString(),
      label,
      available: table !== null,
      tableId: table?.id ?? null,
      tableLabel: table?.label ?? null,
    };
  });
}

/**
 * Alternatives when the requested time is taken.
 *
 * Nearest-first rather than earliest-first: someone who asked for 20:00 wants
 * 19:30 or 20:30 far more than they want noon.
 */
export function suggestAlternatives(
  slots: Slot[],
  wantedStartsAt: string,
  limit = 4,
): Slot[] {
  const wanted = new Date(wantedStartsAt).getTime();
  return slots
    .filter((s) => s.available)
    .map((s) => ({ slot: s, distance: Math.abs(new Date(s.startsAt).getTime() - wanted) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((x) => x.slot);
}

/** Validates a requested date is inside the booking window. */
export function assertBookableDate(date: string, now: Date): void {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) throw new AvailabilityError("That date is not valid.");

  const target = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) throw new AvailabilityError("That date has already passed.");
  if (days > MAX_DAYS_AHEAD) {
    throw new AvailabilityError(
      `Bookings open ${MAX_DAYS_AHEAD} days ahead. Try a nearer date.`,
    );
  }
}
