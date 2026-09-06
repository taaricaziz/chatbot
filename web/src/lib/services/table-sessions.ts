import "server-only";
import {
  closeSession,
  findSessionById,
  findTableByToken,
  openOrJoinSession,
  type TableSession,
} from "@/lib/repositories/tables";
import { getOrdersForSession } from "@/lib/repositories/orders";
import type { CreatedOrder } from "@/lib/services/orders";

/**
 * Dine-in sessions.
 *
 * A dine-in customer never fills in a checkout form — the waiter is standing
 * right there, so asking for a name, phone and payment method is friction
 * with no purpose. Instead a scan opens (or joins) a session, orders are sent
 * to the kitchen in rounds, and the running bill is settled at the counter.
 */

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code: "UNKNOWN_TABLE" | "SESSION_CLOSED" | "NOT_FOUND",
  ) {
    super(message);
  }
}

export interface SessionBill {
  session: TableSession;
  rounds: {
    orderNumber: string;
    placedAt: string;
    status: string;
    items: { name: string; quantity: number; lineTotalPaisa: number }[];
    subtotalPaisa: number;
    taxPaisa: number;
    totalPaisa: number;
  }[];
  subtotalPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
  roundCount: number;
  itemCount: number;
}

/** Resolves a printed QR token to a live session, opening one if needed. */
export async function startSession(token: string): Promise<{
  session: TableSession;
  tableLabel: string;
}> {
  const table = await findTableByToken(token);
  if (!table) {
    throw new SessionError(
      "That code is not recognised. Ask a member of staff for help.",
      "UNKNOWN_TABLE",
    );
  }

  const session = await openOrJoinSession(table);
  return { session, tableLabel: table.label };
}

/**
 * The running bill: every round this session has ordered, rolled up.
 *
 * Tax is summed across rounds rather than recomputed on the total. Each round
 * was taxed at the rate that applied when it was placed, and re-deriving it
 * here would silently disagree with the receipts already issued.
 */
export async function getSessionBill(token: string): Promise<SessionBill> {
  const table = await findTableByToken(token);
  if (!table) {
    throw new SessionError("That code is not recognised.", "UNKNOWN_TABLE");
  }

  const session = await openOrJoinSession(table);
  const orders = await getOrdersForSession(session.id);

  const rounds = orders.map((o: CreatedOrder) => ({
    orderNumber: o.orderNumber,
    placedAt: o.createdAt,
    status: o.status,
    items: o.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      lineTotalPaisa: i.lineTotalPaisa,
    })),
    subtotalPaisa: o.subtotalPaisa,
    taxPaisa: o.taxPaisa,
    totalPaisa: o.totalPaisa,
  }));

  return {
    session,
    rounds,
    subtotalPaisa: rounds.reduce((s, r) => s + r.subtotalPaisa, 0),
    taxPaisa: rounds.reduce((s, r) => s + r.taxPaisa, 0),
    totalPaisa: rounds.reduce((s, r) => s + r.totalPaisa, 0),
    roundCount: rounds.length,
    itemCount: rounds.reduce(
      (s, r) => s + r.items.reduce((n, i) => n + i.quantity, 0),
      0,
    ),
  };
}

export async function requireOpenSession(
  sessionId: string,
): Promise<TableSession> {
  const session = await findSessionById(sessionId);
  if (!session) {
    throw new SessionError("That table session no longer exists.", "NOT_FOUND");
  }
  if (session.status !== "OPEN" && session.status !== "AWAITING_PAYMENT") {
    throw new SessionError(
      "This table session has been closed. Scan the code again to start a new one.",
      "SESSION_CLOSED",
    );
  }
  return session;
}

export { closeSession };
