import "server-only";
import { randomBytes } from "node:crypto";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";

/**
 * Tables and table sessions.
 *
 * Same two-backend pattern as the other repositories. The in-memory fallback
 * is pinned to globalThis because Next bundles route handlers and RSC pages
 * into separate module graphs — a module-level Map would give the QR route
 * and the bill page different copies of the session.
 */

export interface CafeTable {
  id: string;
  label: string;
  capacity: number;
  seating: "INDOOR" | "OUTDOOR";
  qrToken: string;
  isActive: boolean;
}

export interface TableSession {
  id: string;
  tableId: string;
  tableLabel: string;
  status: "OPEN" | "AWAITING_PAYMENT" | "CLOSED" | "ABANDONED";
  openedAt: string;
  closedAt: string | null;
}

/** A session left open past this is treated as abandoned. */
export const SESSION_IDLE_LIMIT_MINUTES = 180;

// ------------------------------------------------------------- in-memory
const g = globalThis as unknown as {
  gooteeTables?: CafeTable[];
  gooteeSessions?: Map<string, TableSession>;
  gooteeTablesWarned?: boolean;
};

/**
 * Demo tables mirroring the seeded rows. Tokens are stable across restarts
 * so a printed QR keeps working in the fallback; the real tokens live in the
 * database and are random per install.
 */
function seedTables(): CafeTable[] {
  const spec: [string, number, "INDOOR" | "OUTDOOR"][] = [
    ["T1", 2, "INDOOR"], ["T2", 2, "INDOOR"], ["T3", 4, "INDOOR"],
    ["T4", 4, "INDOOR"], ["T5", 4, "INDOOR"], ["T6", 6, "INDOOR"],
    ["T7", 6, "INDOOR"], ["T8", 8, "INDOOR"],
    ["P1", 2, "OUTDOOR"], ["P2", 4, "OUTDOOR"], ["P3", 4, "OUTDOOR"], ["P4", 6, "OUTDOOR"],
  ];
  return spec.map(([label, capacity, seating], i) => ({
    id: `tbl-${label.toLowerCase()}`,
    label,
    capacity,
    seating,
    // Deterministic but non-guessable-looking, and clearly marked as demo.
    qrToken: `demo${(i + 1).toString().padStart(2, "0")}${label.toLowerCase()}${"0".repeat(8)}${i}`,
    isActive: true,
  }));
}

const memTables = (g.gooteeTables ??= seedTables());
const memSessions = (g.gooteeSessions ??= new Map<string, TableSession>());

function warnOnce() {
  if (!g.gooteeTablesWarned) {
    g.gooteeTablesWarned = true;
    console.warn(
      "[tables] DATABASE_URL is not set — table sessions are IN MEMORY and " +
        "will be lost on restart. Not suitable for deployment.",
    );
  }
}

export function newQrToken(): string {
  return randomBytes(16).toString("hex");
}

// ----------------------------------------------------------------- reads
export async function findTableByToken(token: string): Promise<CafeTable | null> {
  if (!isDatabaseConfigured) {
    warnOnce();
    return memTables.find((t) => t.qrToken === token && t.isActive) ?? null;
  }

  const row = await getPrisma().restaurantTable.findFirst({
    where: { qrToken: token, isActive: true },
  });
  return row
    ? {
        id: row.id,
        label: row.label,
        capacity: row.capacity,
        seating: row.seating,
        qrToken: row.qrToken,
        isActive: row.isActive,
      }
    : null;
}

export async function listTables(): Promise<CafeTable[]> {
  if (!isDatabaseConfigured) {
    warnOnce();
    return memTables;
  }
  const rows = await getPrisma().restaurantTable.findMany({
    orderBy: { label: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    capacity: r.capacity,
    seating: r.seating,
    qrToken: r.qrToken,
    isActive: r.isActive,
  }));
}

function isStale(session: TableSession): boolean {
  const age = Date.now() - new Date(session.openedAt).getTime();
  return age > SESSION_IDLE_LIMIT_MINUTES * 60_000;
}

/**
 * Opens a session for a table, or joins the one already open.
 *
 * Joining rather than creating is the point: a second person at the same
 * table scanning the same code must land on the SAME bill, not start a rival
 * one. A stale session is closed first, so the next party never inherits it.
 */
export async function openOrJoinSession(
  table: CafeTable,
): Promise<TableSession> {
  if (!isDatabaseConfigured) {
    warnOnce();
    for (const s of memSessions.values()) {
      if (s.tableId !== table.id) continue;
      if (s.status !== "OPEN" && s.status !== "AWAITING_PAYMENT") continue;
      if (isStale(s)) {
        s.status = "ABANDONED";
        s.closedAt = new Date().toISOString();
        continue;
      }
      return s;
    }
    const created: TableSession = {
      id: crypto.randomUUID(),
      tableId: table.id,
      tableLabel: table.label,
      status: "OPEN",
      openedAt: new Date().toISOString(),
      closedAt: null,
    };
    memSessions.set(created.id, created);
    return created;
  }

  const db = getPrisma();
  const cutoff = new Date(Date.now() - SESSION_IDLE_LIMIT_MINUTES * 60_000);

  // Retire anything stale on this table before looking for a live session.
  await db.tableSession.updateMany({
    where: {
      tableId: table.id,
      status: { in: ["OPEN", "AWAITING_PAYMENT"] },
      openedAt: { lt: cutoff },
    },
    data: { status: "ABANDONED", closedAt: new Date() },
  });

  const existing = await db.tableSession.findFirst({
    where: { tableId: table.id, status: { in: ["OPEN", "AWAITING_PAYMENT"] } },
  });
  if (existing) return toSession(existing, table.label);

  try {
    const created = await db.tableSession.create({
      data: { tableId: table.id },
    });
    return toSession(created, table.label);
  } catch {
    // Lost the race against another scan — the partial unique index rejected
    // us, which means a session now exists. Join it.
    const raced = await db.tableSession.findFirst({
      where: { tableId: table.id, status: { in: ["OPEN", "AWAITING_PAYMENT"] } },
    });
    if (raced) return toSession(raced, table.label);
    throw new Error("Could not open a session for this table.");
  }
}

export async function findSessionById(id: string): Promise<TableSession | null> {
  if (!isDatabaseConfigured) return memSessions.get(id) ?? null;

  const row = await getPrisma().tableSession.findUnique({
    where: { id },
    include: { table: { select: { label: true } } },
  });
  return row ? toSession(row, row.table.label) : null;
}

/** Every live session, for the floor view. */
export async function listOpenSessions(): Promise<TableSession[]> {
  if (!isDatabaseConfigured) {
    return [...memSessions.values()]
      .filter((s) => s.status === "OPEN" || s.status === "AWAITING_PAYMENT")
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  }

  const rows = await getPrisma().tableSession.findMany({
    where: { status: { in: ["OPEN", "AWAITING_PAYMENT"] } },
    include: { table: { select: { label: true } } },
    orderBy: { openedAt: "asc" },
  });
  return rows.map((r) => toSession(r, r.table.label));
}

export async function closeSession(
  id: string,
  status: "CLOSED" | "ABANDONED" = "CLOSED",
): Promise<void> {
  if (!isDatabaseConfigured) {
    const s = memSessions.get(id);
    if (s) {
      s.status = status;
      s.closedAt = new Date().toISOString();
    }
    return;
  }
  await getPrisma().tableSession.update({
    where: { id },
    data: { status, closedAt: new Date() },
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSession(row: any, tableLabel: string): TableSession {
  return {
    id: row.id,
    tableId: row.tableId,
    tableLabel,
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}
