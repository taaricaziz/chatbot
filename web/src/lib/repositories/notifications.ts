import "server-only";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import {
  backoffMs,
  MAX_ATTEMPTS,
  type Channel,
  type TemplateId,
} from "@/lib/services/notifications";

/**
 * The notification outbox.
 *
 * An outbox, not a log. A message is queued at the moment the order is
 * confirmed — not sent inline — so a provider being down cannot fail the
 * order, and a confirmed order always has a confirmation waiting for it.
 * A worker drains the queue separately and retries with backoff.
 */

export interface OutboxMessage {
  id: string;
  channel: Channel;
  template: TemplateId;
  recipient: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "DEAD";
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  sentAt: string | null;
  dedupeKey: string;
  orderId: string | null;
  reservationId: string | null;
  createdAt: string;
}

export interface EnqueueInput {
  channel: Channel;
  template: TemplateId;
  recipient: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  orderId?: string | null;
  reservationId?: string | null;
}

const g = globalThis as unknown as {
  gooteeOutbox?: Map<string, OutboxMessage>;
  gooteeOutboxWarned?: boolean;
};
const outbox = (g.gooteeOutbox ??= new Map<string, OutboxMessage>());

function warnOnce() {
  if (!g.gooteeOutboxWarned) {
    g.gooteeOutboxWarned = true;
    console.warn(
      "[notifications] DATABASE_URL is not set — the outbox is IN MEMORY and " +
        "queued messages are lost on restart. Not suitable for deployment.",
    );
  }
}

/**
 * Queues a message, ignoring duplicates.
 *
 * The dedupe key is what stops a retried order POST, or a second run of the
 * worker, from texting somebody twice. Returns false when the message was
 * already queued.
 */
export async function enqueue(input: EnqueueInput): Promise<boolean> {
  if (!isDatabaseConfigured) {
    warnOnce();
    if ([...outbox.values()].some((m) => m.dedupeKey === input.dedupeKey)) {
      return false;
    }
    const msg: OutboxMessage = {
      id: crypto.randomUUID(),
      channel: input.channel,
      template: input.template,
      recipient: input.recipient,
      payload: input.payload,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      sentAt: null,
      dedupeKey: input.dedupeKey,
      orderId: input.orderId ?? null,
      reservationId: input.reservationId ?? null,
      createdAt: new Date().toISOString(),
    };
    outbox.set(msg.id, msg);
    return true;
  }

  try {
    await getPrisma().notification.create({
      data: {
        channel: input.channel,
        template: input.template,
        recipient: input.recipient,
        payload: input.payload as never,
        dedupeKey: input.dedupeKey,
        orderId: input.orderId ?? null,
        reservationId: input.reservationId ?? null,
      },
    });
    return true;
  } catch {
    // Unique violation on dedupe_key — already queued, which is the point.
    return false;
  }
}

/** Messages due to be sent: pending or retryable, backoff elapsed. */
export async function claimDue(limit = 20): Promise<OutboxMessage[]> {
  const now = new Date();

  if (!isDatabaseConfigured) {
    return [...outbox.values()]
      .filter(
        (m) =>
          (m.status === "PENDING" || m.status === "FAILED") &&
          new Date(m.nextAttemptAt) <= now,
      )
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, limit);
  }

  const rows = await getPrisma().notification.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  return rows.map(toMessage);
}

export async function markSent(id: string): Promise<void> {
  if (!isDatabaseConfigured) {
    const m = outbox.get(id);
    if (m) {
      m.status = "SENT";
      m.sentAt = new Date().toISOString();
      m.attempts += 1;
      m.lastError = null;
    }
    return;
  }
  await getPrisma().notification.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
  });
}

/**
 * Records a failure and schedules the retry.
 *
 * Past MAX_ATTEMPTS the message becomes DEAD rather than retrying forever —
 * a wrong phone number is not going to start working, and an endless queue
 * hides the messages that could still be saved.
 */
export async function markFailed(id: string, error: string): Promise<void> {
  const attempts = await currentAttempts(id);
  const next = attempts + 1;
  const dead = next >= MAX_ATTEMPTS;
  const nextAt = new Date(Date.now() + backoffMs(next));

  if (!isDatabaseConfigured) {
    const m = outbox.get(id);
    if (m) {
      m.attempts = next;
      m.status = dead ? "DEAD" : "FAILED";
      m.lastError = error.slice(0, 400);
      m.nextAttemptAt = nextAt.toISOString();
    }
    return;
  }

  await getPrisma().notification.update({
    where: { id },
    data: {
      attempts: next,
      status: dead ? "DEAD" : "FAILED",
      lastError: error.slice(0, 400),
      nextAttemptAt: nextAt,
    },
  });
}

async function currentAttempts(id: string): Promise<number> {
  if (!isDatabaseConfigured) return outbox.get(id)?.attempts ?? 0;
  const row = await getPrisma().notification.findUnique({
    where: { id },
    select: { attempts: true },
  });
  return row?.attempts ?? 0;
}

/** Recent messages, for the admin panel. */
export async function listRecent(limit = 30): Promise<OutboxMessage[]> {
  if (!isDatabaseConfigured) {
    return [...outbox.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  const rows = await getPrisma().notification.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toMessage);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toMessage(row: any): OutboxMessage {
  return {
    id: row.id,
    channel: row.channel,
    template: row.template,
    recipient: row.recipient,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    dedupeKey: row.dedupeKey,
    orderId: row.orderId,
    reservationId: row.reservationId,
    createdAt: row.createdAt.toISOString(),
  };
}
