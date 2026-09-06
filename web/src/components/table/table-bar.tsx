"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/cart-context";
import { formatPKR } from "@/lib/money";
import styles from "./table-bar.module.css";

interface Quote {
  breakdown: { subtotalPaisa: number; taxRateBp: number; taxPaisa: number; totalPaisa: number };
  lines: { slug: string; name: string; quantity: number; lineTotalPaisa: number }[];
}

/**
 * The dine-in ordering bar.
 *
 * A persistent bottom bar rather than a modal cart: modal carts on phones lose
 * orders, and at a table the customer is one-handed with a drink in the other.
 *
 * There is no checkout form here by design — no name, no phone, no payment
 * step. A seated customer is already known to the waiter, so the only act
 * required is an explicit "send to kitchen".
 */
export function TableBar({
  token,
  tableLabel,
  sessionId,
}: {
  token: string;
  tableLabel: string;
  sessionId: string;
}) {
  const router = useRouter();
  const { lines, itemCount, setQuantity, remove, clear, hydrated } = useCart();
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || lines.length === 0) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    fetch("/api/cart/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        lines: lines.map((l) => ({ slug: l.slug, quantity: l.quantity })),
        orderType: "DINE_IN",
        // Dine-in bills are settled at the counter; the counter takes cash or
        // card, and the rate is fixed when they pay, so quote the cash rate.
        paymentMethod: "CASH",
      }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (r.ok) setQuote(d as Quote);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [lines, hydrated]);

  async function sendToKitchen() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          lines: lines.map((l) => ({ slug: l.slug, quantity: l.quantity })),
          orderType: "DINE_IN",
          paymentMethod: "CASH",
          tableSessionId: sessionId,
          customer: { name: `Table ${tableLabel}` },
          confirmed: true,
          expectedTotalPaisa: quote?.breakdown.totalPaisa,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not send that order.");

      clear();
      setOpen(false);
      setSent(data.orderNumber);
      router.refresh();
      window.setTimeout(() => setSent(null), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that order.");
    } finally {
      setSending(false);
    }
  }

  if (!hydrated) return null;

  if (sent) {
    return (
      <div className={`${styles.bar} ${styles.sentBar}`} role="status">
        <span className={styles.sentText}>
          Sent to the kitchen &mdash; round {sent}
        </span>
        <a href={`/t/${token}/bill`} className={styles.sentLink}>
          View bill
        </a>
      </div>
    );
  }

  if (itemCount === 0) return null;

  return (
    <>
      {open && (
        <div className={styles.sheet} role="dialog" aria-label="This round">
          <div className={styles.sheetHead}>
            <h2 className={`display ${styles.sheetTitle}`}>This round</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              &times;
            </button>
          </div>

          <ul className={styles.sheetList} role="list">
            {lines.map((line) => {
              const q = quote?.lines.find((x) => x.slug === line.slug);
              return (
                <li key={line.slug} className={styles.sheetRow}>
                  <span className={styles.sheetName}>{q?.name ?? line.name}</span>
                  <div className={styles.qty}>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.slug, line.quantity - 1)}
                      aria-label={`Decrease ${line.name}`}
                    >
                      &minus;
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.slug, line.quantity + 1)}
                      aria-label={`Increase ${line.name}`}
                    >
                      +
                    </button>
                  </div>
                  <span className={`price ${styles.sheetPrice}`}>
                    {q ? formatPKR(q.lineTotalPaisa) : "—"}
                  </span>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => remove(line.slug)}
                    aria-label={`Remove ${line.name}`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>

          {quote && (
            <dl className={styles.totals}>
              <div>
                <dt>Subtotal</dt>
                <dd>{formatPKR(quote.breakdown.subtotalPaisa)}</dd>
              </div>
              <div>
                <dt>Service tax ({quote.breakdown.taxRateBp / 100}%)</dt>
                <dd>{formatPKR(quote.breakdown.taxPaisa)}</dd>
              </div>
              <div className={styles.grand}>
                <dt>This round</dt>
                <dd className="price">{formatPKR(quote.breakdown.totalPaisa)}</dd>
              </div>
            </dl>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}

          <button
            type="button"
            className={styles.send}
            onClick={sendToKitchen}
            disabled={sending || !quote}
          >
            {sending ? "Sending…" : "Send to kitchen"}
          </button>
          <p className={styles.note}>
            Tax is charged at the counter rate when you settle up.
          </p>
        </div>
      )}

      <button
        type="button"
        className={styles.bar}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.barCount}>{itemCount}</span>
        <span className={styles.barLabel}>
          {open ? "Hide this round" : "Review this round"}
        </span>
        <span className={`price ${styles.barTotal}`}>
          {quote ? formatPKR(quote.breakdown.totalPaisa) : "…"}
        </span>
      </button>
    </>
  );
}
