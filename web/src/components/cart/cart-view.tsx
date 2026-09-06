"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart } from "./cart-context";
import { formatPKR } from "@/lib/money";
import styles from "./cart-view.module.css";

type PaymentMethod = "CASH" | "CARD_AT_COUNTER" | "ONLINE";

interface QuoteResponse {
  lines: {
    slug: string;
    name: string;
    quantity: number;
    unitTotalPaisa: number;
    lineTotalPaisa: number;
    isAvailable: boolean;
  }[];
  breakdown: {
    subtotalPaisa: number;
    discountPaisa: number;
    discountLabel: string | null;
    taxRateBp: number;
    taxPaisa: number;
    deliveryFeePaisa: number;
    totalPaisa: number;
  };
  unknownSlugs: string[];
  unavailableSlugs: string[];
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD_AT_COUNTER", label: "Card" },
  { value: "ONLINE", label: "Online" },
];

export function CartView() {
  const { lines, setQuantity, remove, clear, hydrated } = useCart();
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Every total on this page comes from the server. The client sends slugs
  // and quantities and renders whatever comes back — it never does the maths.
  useEffect(() => {
    if (!hydrated) return;
    if (lines.length === 0) {
      setQuote(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setPending(true);

    fetch("/api/cart/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        lines: lines.map((l) => ({ slug: l.slug, quantity: l.quantity })),
        orderType: "TAKEAWAY",
        paymentMethod: method,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Could not price this cart.");
        setQuote(data as QuoteResponse);
        setError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Could not price this cart.");
      })
      .finally(() => setPending(false));

    return () => controller.abort();
  }, [lines, method, hydrated]);

  if (!hydrated) {
    return <p className={styles.muted}>Loading your cart…</p>;
  }

  if (lines.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={`display ${styles.emptyHeading}`}>Your cart is empty.</p>
        <p className={styles.emptyBody}>
          Nothing in here yet. The menu is one tap away.
        </p>
        <Link href="/menu" className={styles.primary}>
          Browse the menu
        </Link>
      </div>
    );
  }

  const b = quote?.breakdown;

  return (
    <div className={styles.layout}>
      <section className={styles.items} aria-label="Cart items">
        <ul className={styles.list} role="list">
          {lines.map((line) => {
            const quoted = quote?.lines.find((q) => q.slug === line.slug);
            const unavailable = quote?.unavailableSlugs.includes(line.slug);
            const unknown = quote?.unknownSlugs.includes(line.slug);

            return (
              <li key={line.slug} className={styles.row}>
                <div className={styles.rowMain}>
                  <Link href={`/menu/${line.slug}`} className={styles.rowName}>
                    {quoted?.name ?? line.name}
                  </Link>

                  {unknown && (
                    <p className={styles.rowWarn}>
                      No longer on the menu — remove it to continue.
                    </p>
                  )}
                  {unavailable && !unknown && (
                    <p className={styles.rowWarn}>
                      Unavailable today — remove it to continue.
                    </p>
                  )}
                  {quoted && !unknown && (
                    <p className={styles.rowUnit}>
                      {formatPKR(quoted.unitTotalPaisa)} each
                    </p>
                  )}
                </div>

                <div className={styles.qty}>
                  <button
                    type="button"
                    onClick={() => setQuantity(line.slug, line.quantity - 1)}
                    aria-label={`Decrease ${line.name}`}
                  >
                    −
                  </button>
                  <span aria-live="polite">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(line.slug, line.quantity + 1)}
                    disabled={line.quantity >= 20}
                    aria-label={`Increase ${line.name}`}
                  >
                    +
                  </button>
                </div>

                <span className={`price ${styles.rowTotal}`}>
                  {quoted ? formatPKR(quoted.lineTotalPaisa) : "—"}
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

        <div className={styles.itemsFoot}>
          <Link href="/menu" className={styles.ghostSm}>
            Continue shopping
          </Link>
          <button type="button" className={styles.clearBtn} onClick={clear}>
            Clear cart
          </button>
        </div>
      </section>

      <aside className={styles.summary} aria-label="Order summary">
        <h2 className={`display ${styles.summaryHeading}`}>Summary</h2>

        <fieldset className={styles.methods}>
          <legend className={styles.methodsLegend}>Paying by</legend>
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`${styles.method} ${method === m.value ? styles.methodOn : ""}`}
              aria-pressed={method === m.value}
              onClick={() => setMethod(m.value)}
            >
              {m.label}
            </button>
          ))}
        </fieldset>

        {error && <p className={styles.error}>{error}</p>}

        {b && (
          <dl className={styles.totals}>
            <div className={styles.totalRow}>
              <dt>Subtotal</dt>
              <dd>{formatPKR(b.subtotalPaisa)}</dd>
            </div>

            {b.discountPaisa > 0 && (
              <div className={styles.totalRow}>
                <dt>{b.discountLabel ?? "Discount"}</dt>
                <dd className={styles.discount}>−{formatPKR(b.discountPaisa)}</dd>
              </div>
            )}

            <div className={styles.totalRow}>
              <dt>
                Service tax
                <span className={styles.taxNote}>{b.taxRateBp / 100}%</span>
              </dt>
              <dd>{formatPKR(b.taxPaisa)}</dd>
            </div>

            {b.deliveryFeePaisa > 0 && (
              <div className={styles.totalRow}>
                <dt>Delivery</dt>
                <dd>{formatPKR(b.deliveryFeePaisa)}</dd>
              </div>
            )}

            <div className={`${styles.totalRow} ${styles.grand}`}>
              <dt>Total</dt>
              <dd className="price">{formatPKR(b.totalPaisa)}</dd>
            </div>
          </dl>
        )}

        {/* The tax rule is explained rather than left to look like a glitch.
            Sindh charges 15% on cash and 8% on card, wallet and QR. */}
        <p className={styles.taxExplain}>
          {method === "CASH"
            ? "Paying by card or wallet drops service tax from 15% to 8%."
            : "Card, wallet and QR payments are taxed at 8% instead of 15%."}
        </p>

        <Link
          href="/checkout"
          className={`${styles.primary} ${styles.checkout}`}
          aria-disabled={pending}
        >
          Checkout
        </Link>
        <p className={styles.muted}>
          Nothing is ordered until you confirm on the next screen.
        </p>
      </aside>
    </div>
  );
}
