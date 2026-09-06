import "server-only";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { listTables } from "@/lib/repositories/tables";
import type {
  ExistingBooking,
  Seating,
  TableInventory,
} from "@/lib/services/availability";

/**
 * Reservation storage.
 *
 * Same two-backend pattern as everywhere else, pinned to globalThis so the
 * API route and the confirmation page share one store.
 */

export interface StoredReservation {
  id: string;
  reference: string;
  tableId: string;
  tableLabel: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string | null;
  partySize: number;
  startsAt: string;
  endsAt: string;
  seating: Seating;
  status: "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  occasion: string | null;
  requests: string | null;
  createdAt: string;
}

const g = globalThis as unknown as {
  gooteeReservations?: Map<string, StoredReservation>;
  gooteeResWarned?: boolean;
};

const memReservations = (g.gooteeReservations ??= new Map<
  string,
  StoredReservation
>());

function warnOnce() {
  if (!g.gooteeResWarned) {
    g.gooteeResWarned = true;
    console.warn(
      "[reservations] DATABASE_URL is not set — bookings are IN MEMORY and " +
        "will be lost on restart. Not suitable for deployment.",
    );
  }
}

/** Table inventory, including turn length, for the availability engine. */
export async function getTableInventory(): Promise<TableInventory[]> {
  if (!isDatabaseConfigured) {
    const tables = await listTables();
    return tables.map((t) => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      seating: t.seating,
      isActive: t.isActive,
      turnMinutes: 90,
    }));
  }

  const rows = await getPrisma().restaurantTable.findMany({
    orderBy: { label: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    capacity: r.capacity,
    seating: r.seating,
    isActive: r.isActive,
    turnMinutes: r.turnMinutes,
  }));
}

/**
 * Bookings that could touch the given date.
 *
 * Widened by a day either side: a sitting starting at 22:00 runs past
 * midnight, and a query for the following day must still see it.
 */
export async function getBookingsForDate(
  date: string,
): Promise<ExistingBooking[]> {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return [];
  const from = new Date(y, m - 1, d - 1);
  const to = new Date(y, m - 1, d + 2);

  if (!isDatabaseConfigured) {
    warnOnce();
    return [...memReservations.values()]
      .filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW")
      .map((r) => ({
        tableId: r.tableId,
        startsAt: new Date(r.startsAt),
        endsAt: new Date(r.endsAt),
      }))
      .filter((b) => b.endsAt > from && b.startsAt < to);
  }

  const rows = await getPrisma().reservation.findMany({
    where: {
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
    select: { tableId: true, startsAt: true, endsAt: true },
  });

  return rows
    .filter((r): r is typeof r & { tableId: string } => r.tableId !== null)
    .map((r) => ({
      tableId: r.tableId,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
    }));
}

export async function saveReservation(r: StoredReservation): Promise<void> {
  if (!isDatabaseConfigured) {
    warnOnce();

    // Mirror the database's exclusion constraint so the fallback cannot
    // double-book either — otherwise the two backends disagree about what is
    // possible, which is worse than either behaviour alone.
    const clash = [...memReservations.values()].some(
      (x) =>
        x.tableId === r.tableId &&
        x.status !== "CANCELLED" &&
        x.status !== "NO_SHOW" &&
        new Date(x.startsAt) < new Date(r.endsAt) &&
        new Date(x.endsAt) > new Date(r.startsAt),
    );
    if (clash) throw new Error("Table already booked for that period.");

    memReservations.set(r.reference, r);
    return;
  }

  await getPrisma().reservation.create({
    data: {
      id: r.id,
      reference: r.reference,
      tableId: r.tableId,
      guestName: r.guestName,
      guestPhone: r.guestPhone,
      guestEmail: r.guestEmail,
      partySize: r.partySize,
      startsAt: new Date(r.startsAt),
      endsAt: new Date(r.endsAt),
      seating: r.seating,
      status: r.status,
      occasion: r.occasion,
      requests: r.requests,
    },
  });
}

/** Sets a booking status, returning the previous one for the audit trail. */
export async function setReservationStatus(
  reference: string,
  status: string,
): Promise<string | null> {
  const existing = await findReservationByReference(reference);
  if (!existing) return null;

  const closing = status === "CANCELLED" || status === "NO_SHOW";

  if (!isDatabaseConfigured) {
    memReservations.set(reference, {
      ...existing,
      status: status as StoredReservation["status"],
    });
  } else {
    await getPrisma().reservation.update({
      where: { reference },
      data: {
        status: status as never,
        ...(closing ? { cancelledAt: new Date() } : {}),
      },
    });
  }
  return existing.status;
}

/** Upcoming bookings for the admin list. */
export async function listUpcomingReservations(): Promise<StoredReservation[]> {
  const cutoff = new Date(Date.now() - 6 * 3600_000);

  if (!isDatabaseConfigured) {
    return [...memReservations.values()]
      .filter((r) => new Date(r.startsAt) > cutoff)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  const rows = await getPrisma().reservation.findMany({
    where: { startsAt: { gt: cutoff } },
    include: { table: { select: { label: true } } },
    orderBy: { startsAt: "asc" },
    take: 100,
  });

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    tableId: row.tableId ?? "",
    tableLabel: row.table?.label ?? "",
    guestName: row.guestName,
    guestPhone: row.guestPhone,
    guestEmail: row.guestEmail,
    partySize: row.partySize,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    seating: row.seating,
    status: row.status,
    occasion: row.occasion,
    requests: row.requests,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function findReservationByReference(
  reference: string,
): Promise<StoredReservation | null> {
  if (!isDatabaseConfigured) return memReservations.get(reference) ?? null;

  const row = await getPrisma().reservation.findUnique({
    where: { reference },
    include: { table: { select: { label: true } } },
  });
  if (!row) return null;

  return {
    id: row.id,
    reference: row.reference,
    tableId: row.tableId ?? "",
    tableLabel: row.table?.label ?? "",
    guestName: row.guestName,
    guestPhone: row.guestPhone,
    guestEmail: row.guestEmail,
    partySize: row.partySize,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    seating: row.seating,
    status: row.status,
    occasion: row.occasion,
    requests: row.requests,
    createdAt: row.createdAt.toISOString(),
  };
}
