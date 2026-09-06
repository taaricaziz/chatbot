import { requireStaff } from "@/lib/auth";
import { formatPKR } from "@/lib/money";
import { listOpenSessions } from "@/lib/repositories/tables";
import { getOrdersForSession } from "@/lib/repositories/orders";
import { closeTableSession } from "@/lib/services/admin-actions";
import styles from "./floor.module.css";

export const dynamic = "force-dynamic";

export default async function FloorPage() {
  await requireStaff();
  const sessions = await listOpenSessions();

  const withBills = await Promise.all(
    sessions.map(async (session) => {
      const orders = await getOrdersForSession(session.id);
      return {
        session,
        rounds: orders.length,
        items: orders.reduce(
          (n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0),
          0,
        ),
        total: orders.reduce((sum, o) => sum + o.totalPaisa, 0),
        openMinutes: Math.round(
          (Date.now() - new Date(session.openedAt).getTime()) / 60_000,
        ),
      };
    }),
  );

  return (
    <>
      <div className={styles.head}>
        <h1 className={`display ${styles.title}`}>Floor</h1>
        <p className={styles.muted}>
          {sessions.length === 0
            ? "No tables seated."
            : `${sessions.length} ${sessions.length === 1 ? "table" : "tables"} seated`}
        </p>
      </div>

      {withBills.length === 0 ? (
        <p className={styles.empty}>
          Nobody is seated. A session opens when a guest scans a table code.
        </p>
      ) : (
        <ul className={styles.grid} role="list">
          {withBills.map(({ session, rounds, items, total, openMinutes }) => (
            <li key={session.id} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.table}>{session.tableLabel}</span>
                <span className={styles.open}>{openMinutes}m</span>
              </div>

              <dl className={styles.stats}>
                <div>
                  <dt>Rounds</dt>
                  <dd>{rounds}</dd>
                </div>
                <div>
                  <dt>Items</dt>
                  <dd>{items}</dd>
                </div>
                <div>
                  <dt>Bill</dt>
                  <dd className="price">{formatPKR(total)}</dd>
                </div>
              </dl>

              {/* Closing frees the table. Until a session is closed, the next
                  party to scan that code JOINS this bill — which is why this
                  button is the most consequential one on the screen. */}
              <form action={closeTableSession}>
                <input type="hidden" name="sessionId" value={session.id} />
                <button type="submit" className={styles.close}>
                  {total > 0 ? "Settle & close" : "Close (nothing ordered)"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
