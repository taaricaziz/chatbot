import "server-only";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import type { CreatedOrder } from "@/lib/services/orders";

/**
 * Where confirmed orders go.
 *
 * Two backends, same interface — the same pattern as the menu repository:
 *
 *   - PostgreSQL via Prisma, when DATABASE_URL is set. This is the real one.
 *   - An in-process Map, when it is not.
 *
 * THE IN-MEMORY STORE IS NOT PERSISTENCE. Orders vanish on restart and are
 * invisible to any other process. It exists so the checkout flow is
 * demonstrable before credentials are wired, and it says so loudly on every
 * write. It must not survive into a deployment.
 */

export interface SaveContext {
  phone: string | null;
  email: string | null;
  idempotencyKey: string | null;
  source: string;
  /** Set for dine-in orders; null for takeaway and delivery. */
  tableSessionId: string | null;
}

export interface OrderStore {
  save(order: CreatedOrder, ctx: SaveContext): Promise<void>;
  findByIdOrNumber(idOrNumber: string): Promise<CreatedOrder | null>;
  findByIdempotencyKey(key: string): Promise<CreatedOrder | null>;
  findForSession(sessionId: string): Promise<CreatedOrder[]>;
}

// ---------------------------------------------------------------- in-memory
//
// Pinned to globalThis, not module scope. Next bundles route handlers and RSC
// pages into SEPARATE module graphs, so a module-level Map gives the API route
// and the order page different copies — the API would happily create an order
// that the confirmation page then 404s on. Sharing one object per process is
// the only thing that makes the fallback coherent.
const globalForOrders = globalThis as unknown as {
  gooteeOrders?: Map<string, CreatedOrder>;
  gooteeIdempotency?: Map<string, string>;
  gooteeOrdersWarned?: boolean;
};

const memoryOrders = (globalForOrders.gooteeOrders ??= new Map<
  string,
  CreatedOrder
>());
const memoryIdempotency = (globalForOrders.gooteeIdempotency ??= new Map<
  string,
  string
>());

const memoryStore: OrderStore = {
  async save(order, ctx) {
    if (!globalForOrders.gooteeOrdersWarned) {
      globalForOrders.gooteeOrdersWarned = true;
      console.warn(
        "[orders] DATABASE_URL is not set — orders are being kept IN MEMORY " +
          "and will be lost when the server restarts. Not suitable for deployment.",
      );
    }
    memoryOrders.set(order.id, { ...order, tableSessionId: ctx.tableSessionId });
    if (ctx.idempotencyKey) memoryIdempotency.set(ctx.idempotencyKey, order.id);
  },

  async findForSession(sessionId) {
    return [...memoryOrders.values()]
      .filter((o) => o.tableSessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async findByIdOrNumber(idOrNumber) {
    const direct = memoryOrders.get(idOrNumber);
    if (direct) return direct;
    for (const order of memoryOrders.values()) {
      if (order.orderNumber === idOrNumber) return order;
    }
    return null;
  },

  async findByIdempotencyKey(key) {
    const id = memoryIdempotency.get(key);
    return id ? (memoryOrders.get(id) ?? null) : null;
  },
};

// ------------------------------------------------------------------- prisma
const prismaStore: OrderStore = {
  async save(order, ctx) {
    const db = getPrisma();

    await db.$transaction(async (tx) => {
      // Dine-in has no customer record — nobody is asked for a phone number
      // at the table, so the order simply has no customer attached.
      const customer = ctx.phone
        ? await tx.customer.upsert({
            where: { phone: ctx.phone },
            create: {
              phone: ctx.phone,
              name: order.customerName,
              email: ctx.email,
              orderCount: 1,
              totalSpentPaisa: BigInt(order.totalPaisa),
            },
            update: {
              name: order.customerName,
              ...(ctx.email ? { email: ctx.email } : {}),
              orderCount: { increment: 1 },
              totalSpentPaisa: { increment: BigInt(order.totalPaisa) },
            },
          })
        : null;

      await tx.order.create({
        data: {
          id: order.id,
          orderNumber: order.orderNumber,
          customerId: customer?.id ?? null,
          tableSessionId: ctx.tableSessionId,
          type: order.orderType,
          status: "CONFIRMED",
          source: ctx.source as never,
          subtotalPaisa: order.subtotalPaisa,
          discountPaisa: order.discountPaisa,
          taxablePaisa: order.subtotalPaisa - order.discountPaisa,
          taxPaisa: order.taxPaisa,
          deliveryFeePaisa: order.deliveryFeePaisa,
          totalPaisa: order.totalPaisa,
          taxRateBp: order.taxRateBp,
          paymentMethod: order.paymentMethod,
          deliveryAddress: order.delivery?.address ?? null,
          deliveryArea: order.delivery?.area ?? null,
          deliveryLandmark: order.delivery?.landmark ?? null,
          deliveryInstructions: order.delivery?.instructions ?? null,
          notes: order.notes,
          confirmedAt: new Date(order.confirmedAt),
          items: {
            create: order.items.map((i) => ({
              itemNameSnapshot: i.name,
              unitPricePaisaSnapshot: i.unitPricePaisa,
              quantity: i.quantity,
              lineTotalPaisa: i.lineTotalPaisa,
            })),
          },
          payments: {
            create: {
              provider: "OFFLINE",
              method: order.paymentMethod,
              amountPaisa: order.totalPaisa,
              status: "PENDING",
            },
          },
        },
      });

      if (ctx.idempotencyKey) {
        await tx.idempotencyKey.create({
          data: { key: ctx.idempotencyKey, orderId: order.id },
        });
      }
    });
  },

  async findByIdOrNumber(idOrNumber) {
    const db = getPrisma();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrNumber,
      );

    const row = await db.order.findFirst({
      where: isUuid ? { id: idOrNumber } : { orderNumber: idOrNumber },
      include: { items: true, customer: true },
    });
    return row ? rowToOrder(row) : null;
  },

  async findForSession(sessionId) {
    const rows = await getPrisma().order.findMany({
      where: { tableSessionId: sessionId },
      include: { items: true, customer: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToOrder);
  },

  async findByIdempotencyKey(key) {
    const db = getPrisma();
    const record = await db.idempotencyKey.findUnique({
      where: { key },
      include: { order: { include: { items: true, customer: true } } },
    });
    return record?.order ? rowToOrder(record.order) : null;
  },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToOrder(row: any): CreatedOrder {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    orderType: row.type,
    paymentMethod: row.paymentMethod,
    customerName: row.customer?.name ?? "",
    customerPhone: row.customer?.phone ?? null,
    subtotalPaisa: row.subtotalPaisa,
    discountPaisa: row.discountPaisa,
    taxRateBp: row.taxRateBp,
    taxPaisa: row.taxPaisa,
    deliveryFeePaisa: row.deliveryFeePaisa,
    totalPaisa: row.totalPaisa,
    confirmedAt: row.confirmedAt?.toISOString() ?? row.createdAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    items: (row.items ?? []).map((i: any) => ({
      name: i.itemNameSnapshot,
      quantity: i.quantity,
      unitPricePaisa: i.unitPricePaisaSnapshot,
      lineTotalPaisa: i.lineTotalPaisa,
    })),
    delivery: row.deliveryAddress
      ? {
          address: row.deliveryAddress,
          area: row.deliveryArea ?? undefined,
          landmark: row.deliveryLandmark ?? undefined,
          instructions: row.deliveryInstructions ?? undefined,
        }
      : null,
    notes: row.notes ?? null,
    tableSessionId: row.tableSessionId ?? null,
  };
}

/** Valid forward transitions. Anything else is rejected. */
export const ORDER_FLOW: Record<string, string[]> = {
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED"],
  OUT_FOR_DELIVERY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Sets a status and returns the previous one, for the audit trail.
 *
 * Transitions are validated: an order cannot jump from CONFIRMED straight to
 * COMPLETED, and nothing moves out of a terminal state. Without this, one
 * mis-tap on a busy phone silently marks food delivered.
 */
export async function setOrderStatus(
  orderNumber: string,
  status: string,
): Promise<string | null> {
  const store = getOrderStore();
  const order = await store.findByIdOrNumber(orderNumber);
  if (!order) return null;

  const allowed = ORDER_FLOW[order.status] ?? [];
  if (!allowed.includes(status)) {
    throw new Error(`Cannot move an order from ${order.status} to ${status}.`);
  }

  const previous = order.status;

  if (!isDatabaseConfigured) {
    memoryOrders.set(order.id, { ...order, status });
  } else {
    await getPrisma().order.update({
      where: { id: order.id },
      data: { status: status as never },
    });
  }
  return previous;
}

/** The kitchen queue: everything not finished, newest first. */
export async function listActiveOrders(): Promise<CreatedOrder[]> {
  if (!isDatabaseConfigured) {
    return [...memoryOrders.values()]
      .filter((o) => !["COMPLETED", "CANCELLED"].includes(o.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const rows = await getPrisma().order.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    include: { items: true, customer: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToOrder);
}

export async function listAllOrders(limit = 100): Promise<CreatedOrder[]> {
  if (!isDatabaseConfigured) {
    return [...memoryOrders.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  const rows = await getPrisma().order.findMany({
    include: { items: true, customer: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(rowToOrder);
}

export async function getOrdersForSession(
  sessionId: string,
): Promise<CreatedOrder[]> {
  return getOrderStore().findForSession(sessionId);
}

export function getOrderStore(): OrderStore {
  return isDatabaseConfigured ? prismaStore : memoryStore;
}
