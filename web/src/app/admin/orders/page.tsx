import { requireStaff } from "@/lib/auth";
import { formatPKR } from "@/lib/money";
import { listActiveOrders, ORDER_FLOW } from "@/lib/repositories/orders";
import { getMenu } from "@/lib/repositories/menu";
import { updateOrderStatus, toggleAvailability } from "@/lib/services/admin-actions";
import styles from "./orders.module.css";

export const dynamic = "force-dynamic";

const NEXT_LABEL: Record<string, string> = {
  PREPARING: "Start cooking",
  READY: "Mark ready",
  OUT_FOR_DELIVERY: "Send out",
  COMPLETED: "Complete",
  CANCELLED: "Cancel",
};

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export default async function OrdersPage() {
  await requireStaff();
  const [orders, menu] = await Promise.all([listActiveOrders(), getMenu()]);

  return (
    <>
      <div className={styles.head}>
        <h1 className={`display ${styles.title}`}>Orders</h1>
        <p className={styles.muted}>
          {orders.length === 0
            ? "Nothing in the queue."
            : `${orders.length} in the queue · refreshes on every action`}
        </p>
      </div>

      {/* The most-used control in the whole console lives at the TOP of the
          busiest screen, not four levels deep in the menu editor: the kitchen
          runs out of something mid-service and needs it gone in one tap. */}
      <details className={styles.eightySix}>
        <summary className={styles.eightySixHead}>
          Run out of something? Take it off the board
        </summary>
        <div className={styles.chipGrid}>
          {menu.map((item) => (
            <form action={toggleAvailability} key={item.slug}>
              <input type="hidden" name="slug" value={item.slug} />
              <input type="hidden" name="available" value={item.isAvailable ? "false" : "true"} />
              <button
                type="submit"
                className={`${styles.chip} ${item.isAvailable ? "" : styles.chipOff}`}
              >
                {item.name}
              </button>
            </form>
          ))}
        </div>
      </details>

      {orders.length === 0 ? (
        <p className={styles.empty}>The kitchen is clear.</p>
      ) : (
        <ul className={styles.list} role="list">
          {orders.map((order) => {
            const waited = minutesAgo(order.createdAt);
            const next = ORDER_FLOW[order.status] ?? [];

            return (
              <li
                key={order.id}
                className={`${styles.card} ${waited > 25 ? styles.late : ""}`}
              >
                <div className={styles.cardHead}>
                  <span className={styles.number}>{order.orderNumber}</span>
                  <span className={styles.type}>
                    {order.orderType === "DINE_IN"
                      ? "Dine-in"
                      : order.orderType === "DELIVERY"
                        ? "Delivery"
                        : "Takeaway"}
                  </span>
                  <span className={styles.status}>{order.status}</span>
                  <span className={`${styles.waited} ${waited > 25 ? styles.waitedLate : ""}`}>
                    {waited}m
                  </span>
                </div>

                <ul className={styles.items} role="list">
                  {order.items.map((item, i) => (
                    <li key={`${item.name}-${i}`}>
                      <span className={styles.qty}>{item.quantity}&times;</span>
                      {item.name}
                    </li>
                  ))}
                </ul>

                {order.notes && <p className={styles.note}>&ldquo;{order.notes}&rdquo;</p>}

                <div className={styles.meta}>
                  <span>{order.customerName}</span>
                  <span className="price">{formatPKR(order.totalPaisa)}</span>
                  <span>
                    {order.paymentMethod === "CASH" ? "Cash" : "Card/online"}
                  </span>
                </div>

                {order.delivery && (
                  <p className={styles.address}>
                    {order.delivery.address}
                    {order.delivery.landmark ? ` — near ${order.delivery.landmark}` : ""}
                  </p>
                )}

                <div className={styles.actions}>
                  {next.map((status) => (
                    <form action={updateOrderStatus} key={status}>
                      <input type="hidden" name="orderNumber" value={order.orderNumber} />
                      <input type="hidden" name="status" value={status} />
                      <button
                        type="submit"
                        className={`${styles.action} ${status === "CANCELLED" ? styles.danger : ""}`}
                      >
                        {NEXT_LABEL[status] ?? status}
                      </button>
                    </form>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
