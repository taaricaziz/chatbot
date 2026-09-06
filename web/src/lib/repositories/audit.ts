import "server-only";

/**
 * Audit trail.
 *
 * Every staff mutation is recorded with before/after. Price changes above
 * all: when a customer disputes a total, you need to know what the price was
 * at 7:42pm and who changed it.
 *
 * Append-only by design — nothing here offers an update or delete.
 */

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

const g = globalThis as unknown as { gooteeAudit?: AuditEntry[] };
const entries = (g.gooteeAudit ??= []);

export async function recordAudit(
  entry: Omit<AuditEntry, "id" | "at">,
): Promise<void> {
  entries.unshift({
    ...entry,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  });
  // Bound the in-memory log so a long-running dev server cannot grow forever.
  if (entries.length > 500) entries.length = 500;
}

export async function listAudit(limit = 50): Promise<AuditEntry[]> {
  return entries.slice(0, limit);
}
