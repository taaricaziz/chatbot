import { requireStaff } from "@/lib/auth";
import { listUpcomingReservations } from "@/lib/repositories/reservations";
import { decideReservation } from "@/lib/services/admin-actions";
import styles from "./bookings.module.css";

export const dynamic = "force-dynamic";

const ACTIONS: Record<
  string,
  { status: string; label: string; danger?: boolean }[]
> = {
  PENDING: [
    { status: "CONFIRMED", label: "Approve" },
    { status: "CANCELLED", label: "Decline", danger: true },
  ],
  CONFIRMED: [
    { status: "SEATED", label: "Seat" },
    { status: "NO_SHOW", label: "No show", danger: true },
    { status: "CANCELLED", label: "Cancel", danger: true },
  ],
  SEATED: [{ status: "COMPLETED", label: "Complete" }],
};

export default async function BookingsPage() {
  await requireStaff();
  const bookings = await listUpcomingReservations();
  const pending = bookings.filter((b) => b.status === "PENDING");

  return (
    <>
      <div className={styles.head}>
        <h1 className={`display ${styles.title}`}>Bookings</h1>
        <p className={styles.muted}>
          {pending.length > 0
            ? `${pending.length} waiting for approval`
            : `${bookings.length} upcoming`}
        </p>
      </div>

      {bookings.length === 0 ? (
        <p className={styles.empty}>No upcoming bookings.</p>
      ) : (
        <ul className={styles.list} role="list">
          {bookings.map((b) => {
            const when = new Date(b.startsAt);
            const actions = ACTIONS[b.status] ?? [];

            return (
              <li
                key={b.reference}
                className={`${styles.row} ${
                  b.status === "PENDING" ? styles.needsAction : ""
                }`}
              >
                <div className={styles.when}>
                  <span className={styles.time}>
                    {when.toLocaleTimeString("en-PK", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className={styles.date}>
                    {when.toLocaleDateString("en-PK", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>

                <div className={styles.who}>
                  <span className={styles.guest}>{b.guestName}</span>
                  <span className={styles.detail}>
                    {b.partySize} {b.partySize === 1 ? "guest" : "guests"}
                    {b.tableLabel ? ` · table ${b.tableLabel}` : ""}
                    {b.seating !== "ANY" ? ` · ${b.seating.toLowerCase()}` : ""}
                  </span>
                  <span className={styles.phone}>{b.guestPhone}</span>
                  {b.occasion && (
                    <span className={styles.occasion}>{b.occasion}</span>
                  )}
                  {b.requests && (
                    <span className={styles.requests}>
                      &ldquo;{b.requests}&rdquo;
                    </span>
                  )}
                </div>

                <div className={styles.right}>
                  <span
                    className={`${styles.status} ${styles["s" + b.status] ?? ""}`}
                  >
                    {b.status}
                  </span>
                  <span className={styles.ref}>{b.reference}</span>
                  <div className={styles.actions}>
                    {actions.map((a) => (
                      <form action={decideReservation} key={a.status}>
                        <input type="hidden" name="reference" value={b.reference} />
                        <input type="hidden" name="status" value={a.status} />
                        <button
                          type="submit"
                          className={`${styles.action} ${a.danger ? styles.danger : ""}`}
                        >
                          {a.label}
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
