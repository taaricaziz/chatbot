"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/components/cart/cart-context";
import { formatPKR } from "@/lib/money";
import styles from "./checkout-form.module.css";

type OrderType = "TAKEAWAY" | "DELIVERY";
type PaymentMethod = "CASH" | "CARD_ON_DELIVERY" | "CARD_AT_COUNTER" | "ONLINE";

interface Quote {
  lines: { slug: string; name: string; quantity: number; lineTotalPaisa: number }[];
  breakdown: {
    subtotalPaisa: number;
    discountPaisa: number;
    discountLabel: string | null;
    taxRateBp: number;
    taxPaisa: number;
    deliveryFeePaisa: number;
    totalPaisa: number;
  };
  unavailableSlugs: string[];
  unknownSlugs: string[];
  delivery: {
    covered: boolean;
    zoneName: string | null;
    feePaisa: number;
    minOrderPaisa: number;
    etaMinMinutes: number | null;
    etaMaxMinutes: number | null;
    meetsMinimum: boolean;
    shortfallPaisa: number;
  } | null;
}

const PAYMENT_FOR: Record<OrderType, { value: PaymentMethod; label: string }[]> = {
  TAKEAWAY: [
    { value: "CASH", label: "Cash at counter" },
    { value: "CARD_AT_COUNTER", label: "Card at counter" },
    { value: "ONLINE", label: "Pay online" },
  ],
  DELIVERY: [
    { value: "CASH", label: "Cash on delivery" },
    { value: "CARD_ON_DELIVERY", label: "Card on delivery" },
    { value: "ONLINE", label: "Pay online" },
  ],
};

export function CheckoutForm() {
  const router = useRouter();
  const { lines, clear, hydrated } = useCart();

  const [orderType, setOrderType] = useState<OrderType>("TAKEAWAY");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [landmark, setLandmark] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notes, setNotes] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per checkout attempt. Retrying the same confirmation reuses it,
  // so a double-tap or a flaky connection cannot create two orders.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (!hydrated || lines.length === 0) return;
    const controller = new AbortController();

    fetch("/api/cart/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        lines: lines.map((l) => ({ slug: l.slug, quantity: l.quantity })),
        orderType,
        paymentMethod: method,
        ...(orderType === "DELIVERY"
          ? { deliveryAddress: address, deliveryArea: area || undefined }
          : {}),
      }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error?.message ?? "Could not price this cart.");
        setQuote(d as Quote);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Could not price this cart.");
      });

    return () => controller.abort();
    // `address` and `area` are dependencies: the fee is a property of where
    // the food is going, so typing a new address must re-price the order.
  }, [lines, orderType, method, address, area, hydrated]);

  const methods = PAYMENT_FOR[orderType];
  useEffect(() => {
    if (!methods.some((m) => m.value === method)) setMethod(methods[0]!.value);
  }, [methods, method]);

  const detailsValid = useMemo(() => {
    if (name.trim().length < 2) return false;
    if (!/^(?:\+92|0)?3\d{9}$/.test(phone.replace(/[\s-()]/g, ""))) return false;
    if (orderType === "DELIVERY" && address.trim().length < 6) return false;
    return true;
  }, [name, phone, orderType, address]);

  async function confirmOrder() {
    if (!quote) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          lines: lines.map((l) => ({ slug: l.slug, quantity: l.quantity })),
          orderType,
          paymentMethod: method,
          customer: { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined },
          ...(orderType === "DELIVERY"
            ? {
                delivery: {
                  address: address.trim(),
                  area: area.trim() || undefined,
                  landmark: landmark.trim() || undefined,
                  instructions: instructions.trim() || undefined,
                },
              }
            : {}),
          notes: notes.trim() || undefined,
          confirmed: true,
          // The total the customer is looking at. If the server computes
          // anything else, it refuses rather than charging a different price.
          expectedTotalPaisa: quote.breakdown.totalPaisa,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not place this order.");

      clear();
      router.push(`/order/${data.orderNumber}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place this order.");
      setSubmitting(false);
    }
  }

  if (!hydrated) return <p className={styles.muted}>Loading…</p>;

  if (lines.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={`display ${styles.emptyHeading}`}>Nothing to check out.</p>
        <Link href="/menu" className={styles.primary}>
          Browse the menu
        </Link>
      </div>
    );
  }

  const b = quote?.breakdown;
  const itemsBlocked =
    (quote?.unavailableSlugs.length ?? 0) > 0 || (quote?.unknownSlugs.length ?? 0) > 0;

  const dq = quote?.delivery ?? null;
  const addressEntered = orderType === "DELIVERY" && address.trim().length >= 6;
  const outOfArea = addressEntered && dq !== null && !dq.covered;
  const belowMinimum = addressEntered && dq !== null && dq.covered && !dq.meetsMinimum;
  const blocked = itemsBlocked || outOfArea || belowMinimum;

  const fmtRs = (paisa: number) =>
    `Rs. ${Math.round(paisa / 100).toLocaleString("en-PK")}`;

  // ---------------------------------------------------------------- review
  if (reviewing && b) {
    return (
      <div className={styles.review}>
        <h2 className={`display ${styles.reviewHeading}`}>Check this over</h2>
        <p className={styles.reviewLede}>
          Nothing has been ordered yet. The kitchen sees this only after you
          confirm below.
        </p>

        <dl className={styles.reviewList}>
          <div className={styles.reviewRow}>
            <dt>Order type</dt>
            <dd>{orderType === "DELIVERY" ? "Delivery" : "Takeaway"}</dd>
          </div>
          <div className={styles.reviewRow}>
            <dt>Name</dt>
            <dd>{name}</dd>
          </div>
          <div className={styles.reviewRow}>
            <dt>Phone</dt>
            <dd>{phone}</dd>
          </div>
          {orderType === "DELIVERY" && (
            <div className={styles.reviewRow}>
              <dt>Address</dt>
              <dd>{address}{landmark ? ` (near ${landmark})` : ""}</dd>
            </div>
          )}
          <div className={styles.reviewRow}>
            <dt>Paying by</dt>
            <dd>{methods.find((m) => m.value === method)?.label}</dd>
          </div>
        </dl>

        <ul className={styles.reviewItems} role="list">
          {quote.lines.map((l) => (
            <li key={l.slug}>
              <span>
                {l.quantity} × {l.name}
              </span>
              <span className="price">{formatPKR(l.lineTotalPaisa)}</span>
            </li>
          ))}
        </ul>

        <dl className={styles.totals}>
          <div className={styles.totalRow}>
            <dt>Subtotal</dt>
            <dd>{formatPKR(b.subtotalPaisa)}</dd>
          </div>
          <div className={styles.totalRow}>
            <dt>Service tax ({b.taxRateBp / 100}%)</dt>
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

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.reviewActions}>
          <button
            type="button"
            className={styles.confirm}
            onClick={confirmOrder}
            disabled={submitting}
          >
            {submitting ? "Placing order…" : `Confirm order · ${formatPKR(b.totalPaisa)}`}
          </button>
          <button
            type="button"
            className={styles.back}
            onClick={() => setReviewing(false)}
            disabled={submitting}
          >
            Go back and edit
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------- form
  return (
    <form
      className={styles.layout}
      onSubmit={(e) => {
        e.preventDefault();
        if (detailsValid && !blocked) setReviewing(true);
      }}
    >
      <div className={styles.fields}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>How would you like it?</legend>
          <div className={styles.segmented}>
            {(["TAKEAWAY", "DELIVERY"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`${styles.segment} ${orderType === t ? styles.segmentOn : ""}`}
                aria-pressed={orderType === t}
                onClick={() => setOrderType(t)}
              >
                {t === "TAKEAWAY" ? "Takeaway" : "Delivery"}
              </button>
            ))}
          </div>
          <p className={styles.hint}>
            Dining in? Scan the QR code on your table instead — no details needed.
          </p>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Your details</legend>
          <label className={styles.field}>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
          <label className={styles.field}>
            <span>Mobile number</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0300 1234567"
              inputMode="tel"
              autoComplete="tel"
              required
            />
          </label>
          <label className={styles.field}>
            <span>Email <em>optional</em></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
        </fieldset>

        {orderType === "DELIVERY" && (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Where to?</legend>
            <label className={styles.field}>
              <span>Address</span>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} required />
            </label>
            <label className={styles.field}>
              <span>Area <em>optional</em></span>
              <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="DHA Phase 6" />
            </label>
            <label className={styles.field}>
              <span>Landmark <em>optional</em></span>
              <input value={landmark} onChange={(e) => setLandmark(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Delivery instructions <em>optional</em></span>
              <input value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </label>
          </fieldset>
        )}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Payment</legend>
          <div className={styles.methods}>
            {methods.map((m) => (
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
          </div>
          <p className={styles.hint}>
            Sindh charges 15% service tax on cash and 8% on card, wallet and QR —
            so the total below changes with this choice.
          </p>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Anything else?</legend>
          <label className={styles.field}>
            <span>Notes for the kitchen <em>optional</em></span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
        </fieldset>
      </div>

      <aside className={styles.summary}>
        <h2 className={`display ${styles.summaryHeading}`}>Your order</h2>

        <ul className={styles.summaryItems} role="list">
          {(quote?.lines ?? []).map((l) => (
            <li key={l.slug}>
              <span>{l.quantity} × {l.name}</span>
              <span className="price">{formatPKR(l.lineTotalPaisa)}</span>
            </li>
          ))}
        </ul>

        {b && (
          <dl className={styles.totals}>
            <div className={styles.totalRow}>
              <dt>Subtotal</dt>
              <dd>{formatPKR(b.subtotalPaisa)}</dd>
            </div>
            <div className={styles.totalRow}>
              <dt>Service tax ({b.taxRateBp / 100}%)</dt>
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

        {itemsBlocked && (
          <p className={styles.error}>
            Some items are unavailable. Edit your cart to continue.
          </p>
        )}

        {outOfArea && (
          <p className={styles.error}>
            We don&rsquo;t deliver to that address yet. Switch to takeaway, or
            call the café to check.
          </p>
        )}

        {belowMinimum && dq && (
          <p className={styles.error}>
            Delivery to {dq.zoneName} starts at {fmtRs(dq.minOrderPaisa)}. Add{" "}
            {fmtRs(dq.shortfallPaisa)} more to continue.
          </p>
        )}

        {addressEntered && dq?.covered && dq.meetsMinimum && (
          <p className={styles.zoneNote}>
            Delivering to <strong>{dq.zoneName}</strong> · estimated{" "}
            <strong>
              {dq.etaMinMinutes}&ndash;{dq.etaMaxMinutes} min
            </strong>{" "}
            from when the kitchen starts. Traffic decides the rest &mdash;
            it&rsquo;s an estimate, not a promise.
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.primary} disabled={!detailsValid || blocked || !quote}>
          Review order
        </button>
        <p className={styles.muted}>
          You&rsquo;ll see a full summary before anything is ordered.
        </p>
      </aside>
    </form>
  );
}
