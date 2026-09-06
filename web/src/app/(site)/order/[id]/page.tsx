import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CAFE, directionsUrl } from "@/lib/cafe";
import { formatPKR } from "@/lib/money";
import { getOrder } from "@/lib/services/orders";
import styles from "./order.module.css";

export const metadata: Metadata = {
  title: "Order confirmed",
  robots: { index: false },
};

// Order state changes; never serve it from a cache.
export const dynamic = "force-dynamic";

const STAGES = [
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "PREPARING", label: "In the kitchen" },
  { key: "READY", label: "Ready" },
  { key: "COMPLETED", label: "Collected" },
] as const;

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  const currentIndex = STAGES.findIndex((s) => s.key === order.status);
  const firstName = order.customerName.split(" ")[0];

  return (
    <section className={`page ${styles.wrap}`}>
      <div className={styles.header}>
        <p className={`eyebrow ${styles.eyebrow}`}>Order confirmed</p>
        <h1 className={`display ${styles.number}`}>{order.orderNumber}</h1>
        <p className={styles.lede}>
          Thanks {firstName} &mdash; the kitchen has it.
          {order.orderType === "DELIVERY"
            ? " We’ll call when the rider sets off."
            : " We’ll text when it’s ready to collect."}
        </p>
      </div>

      <ol className={styles.track} role="list">
        {STAGES.map((stage, i) => (
          <li
            key={stage.key}
            className={`${styles.stage} ${i <= currentIndex ? styles.stageDone : ""}`}
          >
            <span className={styles.stageDot} aria-hidden="true" />
            <span className={styles.stageLabel}>{stage.label}</span>
          </li>
        ))}
      </ol>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h2 className={`eyebrow ${styles.cardHead}`}>Your order</h2>
          <ul className={styles.items} role="list">
            {order.items.map((item, i) => (
              <li key={`${item.name}-${i}`}>
                <span>
                  {item.quantity} &times; {item.name}
                </span>
                <span className="price">{formatPKR(item.lineTotalPaisa)}</span>
              </li>
            ))}
          </ul>

          <dl className={styles.totals}>
            <div className={styles.totalRow}>
              <dt>Subtotal</dt>
              <dd>{formatPKR(order.subtotalPaisa)}</dd>
            </div>
            {order.discountPaisa > 0 && (
              <div className={styles.totalRow}>
                <dt>Discount</dt>
                <dd>&minus;{formatPKR(order.discountPaisa)}</dd>
              </div>
            )}
            <div className={styles.totalRow}>
              <dt>Service tax ({order.taxRateBp / 100}%)</dt>
              <dd>{formatPKR(order.taxPaisa)}</dd>
            </div>
            {order.deliveryFeePaisa > 0 && (
              <div className={styles.totalRow}>
                <dt>Delivery</dt>
                <dd>{formatPKR(order.deliveryFeePaisa)}</dd>
              </div>
            )}
            <div className={`${styles.totalRow} ${styles.grand}`}>
              <dt>Total</dt>
              <dd className="price">{formatPKR(order.totalPaisa)}</dd>
            </div>
          </dl>

          <p className={styles.payNote}>
            {order.paymentMethod === "CASH"
              ? "Paying by cash"
              : order.paymentMethod === "ONLINE"
                ? "Paying online"
                : "Paying by card"}
            {" · "}
            {order.orderType === "DELIVERY" ? "Delivery" : "Takeaway"}
          </p>
        </div>

        <div className={styles.card}>
          <h2 className={`eyebrow ${styles.cardHead}`}>
            {order.orderType === "DELIVERY" ? "Delivering to" : "Collect from"}
          </h2>

          {order.orderType === "DELIVERY" && order.delivery ? (
            <address className={styles.address}>
              {order.delivery.address}
              {order.delivery.landmark && (
                <>
                  <br />
                  Near {order.delivery.landmark}
                </>
              )}
              {order.delivery.area && (
                <>
                  <br />
                  {order.delivery.area}
                </>
              )}
            </address>
          ) : (
            <>
              <address className={styles.address}>
                {CAFE.name}
                <br />
                {CAFE.address.line1}
                <br />
                {CAFE.address.line2}
                <br />
                {CAFE.address.locality}, {CAFE.address.city}
              </address>
              <a
                className={styles.link}
                href={directionsUrl()}
                target="_blank"
                rel="noreferrer"
              >
                Get directions &rarr;
              </a>
            </>
          )}

          {order.notes && (
            <>
              <h2 className={`eyebrow ${styles.cardHead}`}>Notes</h2>
              <p className={styles.notes}>{order.notes}</p>
            </>
          )}

          {/* Phone rendered as text, never a tel: link — see lib/cafe.ts */}
          <p className={styles.help}>
            Something wrong? Call the caf&eacute; on {CAFE.phoneDisplay} and quote{" "}
            <strong>{order.orderNumber}</strong>.
          </p>
        </div>
      </div>

      <div className={styles.actions}>
        <Link href="/menu" className={styles.primary}>
          Order something else
        </Link>
      </div>
    </section>
  );
}
