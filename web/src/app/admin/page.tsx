import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { formatPKR } from "@/lib/money";
import { listActiveOrders, listAllOrders } from "@/lib/repositories/orders";
import { listUpcomingReservations } from "@/lib/repositories/reservations";
import { listOpenSessions } from "@/lib/repositories/tables";
import { getMenu } from "@/lib/repositories/menu";
import { listAudit } from "@/lib/repositories/audit";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  await requireStaff();

  const [active, all, bookings, sessions, menu, audit] = await Promise.all([
    listActiveOrders(),
    listAllOrders(200),
    listUpcomingReservations(),
    listOpenSessions(),
    getMenu(),
    listAudit(8),
  ]);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todays = all.filter((o) => new Date(o.createdAt) >= startOfDay);

  // Revenue comes from the orders themselves, not an analytics vendor — the
  // number on this screen has to reconcile with the till.
  const revenue = todays.reduce((sum, o) => sum + o.totalPaisa, 0);
  const avg = todays.length ? Math.round(revenue / todays.length) : 0;

  const pending = bookings.filter((b) => b.status === "PENDING");
  const offBoard = menu.filter((m) => !m.isAvailable);

  const covers = bookings
    .filter((b) => b.status === "CONFIRMED" || b.status === "PENDING")
    .filter((b) => {
      const d = new Date(b.startsAt);
      return d >= startOfDay && d < new Date(startOfDay.getTime() + 86_400_000);
    })
    .reduce((sum, b) => sum + b.partySize, 0);

  return (
    <>
      <h1 className={`display ${styles.title}`}>Today</h1>

      <div className={styles.stats}>
        <Stat label="Live orders" value={String(active.length)} href="/admin/orders" tone={active.length > 0 ? "hot" : "calm"} />
        <Stat label="Tables seated" value={String(sessions.length)} href="/admin/floor" tone={sessions.length > 0 ? "hot" : "calm"} />
        <Stat label="Bookings to approve" value={String(pending.length)} href="/admin/reservations" tone={pending.length > 0 ? "warn" : "calm"} />
        <Stat label="Off the board" value={String(offBoard.length)} href="/admin/menu" tone={offBoard.length > 0 ? "warn" : "calm"} />
        <Stat label="Orders today" value={String(todays.length)} />
        <Stat label="Revenue today" value={formatPKR(revenue)} />
        <Stat label="Average order" value={todays.length ? formatPKR(avg) : "—"} />
        <Stat label="Covers booked" value={String(covers)} />
      </div>

      {offBoard.length > 0 && (
        <section className={styles.panel}>
          <h2 className={`eyebrow ${styles.panelHead}`}>Currently 86&rsquo;d</h2>
          <p className={styles.offList}>
            {offBoard.map((m) => m.name).join(" · ")}
          </p>
          <Link href="/admin/menu" className={styles.panelLink}>
            Put something back on &rarr;
          </Link>
        </section>
      )}

      <section className={styles.panel}>
        <h2 className={`eyebrow ${styles.panelHead}`}>Recent activity</h2>
        {audit.length === 0 ? (
          <p className={styles.muted}>Nothing yet today.</p>
        ) : (
          <ul className={styles.audit} role="list">
            {audit.map((a) => (
              <li key={a.id}>
                <span className={styles.auditWhen}>
                  {new Date(a.at).toLocaleTimeString("en-PK", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className={styles.auditAction}>{a.action}</span>
                <span className={styles.auditEntity}>{a.entityId}</span>
                <span className={styles.auditActor}>{a.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  href,
  tone = "calm",
}: {
  label: string;
  value: string;
  href?: string;
  tone?: "calm" | "hot" | "warn";
}) {
  const body = (
    <>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </>
  );

  // State is encoded in form as well as number, so what needs attention reads
  // at a glance rather than having to be counted.
  const cls = `${styles.stat} ${tone === "hot" ? styles.hot : tone === "warn" ? styles.warn : ""}`;

  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
