"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./reserve-form.module.css";

type Seating = "INDOOR" | "OUTDOOR" | "ANY";

interface Slot {
  startsAt: string;
  label: string;
  available: boolean;
  tableLabel: string | null;
}

/** Today in local time as YYYY-MM-DD, without UTC shifting the date. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y!, m! - 1, d! + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
    next.getDate(),
  ).padStart(2, "0")}`;
}

export function ReserveForm() {
  const router = useRouter();

  const [date, setDate] = useState(todayLocal);
  const [partySize, setPartySize] = useState(2);
  const [seating, setSeating] = useState<Seating>("ANY");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [occasion, setOccasion] = useState("");
  const [requests, setRequests] = useState("");

  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<Slot[]>([]);

  // Availability is re-fetched whenever the party, date or seating changes —
  // a 2-top free at 20:00 says nothing about a table for six.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setChosen(null);

    fetch(
      `/api/reservations/availability?date=${date}&partySize=${partySize}&seating=${seating}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error?.message ?? "Could not check availability.");
        setSlots(d.slots as Slot[]);
        setError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setSlots([]);
        setError(e instanceof Error ? e.message : "Could not check availability.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [date, partySize, seating]);

  const detailsValid = useMemo(
    () =>
      name.trim().length >= 2 &&
      /^(?:\+92|0)?3\d{9}$/.test(phone.replace(/[\s-()]/g, "")) &&
      chosen !== null,
    [name, phone, chosen],
  );

  const anyAvailable = slots.some((s) => s.available);

  async function confirmBooking() {
    if (!chosen) return;
    setSubmitting(true);
    setError(null);
    setAlternatives([]);

    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          startsAt: chosen.startsAt,
          partySize,
          seating,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          occasion: occasion.trim() || undefined,
          requests: requests.trim() || undefined,
          confirmed: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAlternatives((data?.error?.alternatives ?? []) as Slot[]);
        throw new Error(data?.error?.message ?? "Could not make that booking.");
      }

      router.push(`/reserve/${data.reference}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make that booking.");
      setReviewing(false);
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------- review
  if (reviewing && chosen) {
    const when = new Date(chosen.startsAt);
    return (
      <div className={styles.review}>
        <h2 className={`display ${styles.reviewHeading}`}>Check this over</h2>
        <p className={styles.reviewLede}>
          Nothing is booked yet. The table is held only once you confirm below.
        </p>

        <dl className={styles.reviewList}>
          <div><dt>Date</dt><dd>{when.toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long" })}</dd></div>
          <div><dt>Time</dt><dd>{chosen.label}</dd></div>
          <div><dt>Guests</dt><dd>{partySize}</dd></div>
          <div><dt>Seating</dt><dd>{seating === "ANY" ? "No preference" : seating === "INDOOR" ? "Indoor" : "Terrace"}</dd></div>
          <div><dt>Name</dt><dd>{name}</dd></div>
          <div><dt>Phone</dt><dd>{phone}</dd></div>
          {occasion && <div><dt>Occasion</dt><dd>{occasion}</dd></div>}
          {requests && <div><dt>Requests</dt><dd>{requests}</dd></div>}
        </dl>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.reviewActions}>
          <button type="button" className={styles.confirm} onClick={confirmBooking} disabled={submitting}>
            {submitting ? "Booking…" : "Confirm booking"}
          </button>
          <button type="button" className={styles.back} onClick={() => setReviewing(false)} disabled={submitting}>
            Go back and edit
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- form
  return (
    <form
      className={styles.layout}
      onSubmit={(e) => {
        e.preventDefault();
        if (detailsValid) setReviewing(true);
      }}
    >
      <div className={styles.fields}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>When and how many</legend>

          <div className={styles.row}>
            <label className={styles.field}>
              <span>Date</span>
              <input
                type="date"
                value={date}
                min={todayLocal()}
                max={addDays(todayLocal(), 60)}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span>Guests</span>
              <select value={partySize} onChange={(e) => setPartySize(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.segmented}>
            {([["ANY", "No preference"], ["INDOOR", "Indoor"], ["OUTDOOR", "Terrace"]] as const).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.segment} ${seating === value ? styles.segmentOn : ""}`}
                  aria-pressed={seating === value}
                  onClick={() => setSeating(value)}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Pick a time</legend>

          {loading && <p className={styles.muted}>Checking the book…</p>}

          {!loading && !anyAvailable && (
            <p className={styles.noneLeft}>
              Nothing free for {partySize} {partySize === 1 ? "guest" : "guests"} on this
              date{seating !== "ANY" ? " with that seating" : ""}. Try another day, a
              smaller party, or call us &mdash; we sometimes fit people in.
            </p>
          )}

          {!loading && anyAvailable && (
            <div className={styles.slots}>
              {slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  type="button"
                  className={`${styles.slot} ${chosen?.startsAt === slot.startsAt ? styles.slotOn : ""}`}
                  disabled={!slot.available}
                  aria-pressed={chosen?.startsAt === slot.startsAt}
                  onClick={() => setChosen(slot)}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Your details</legend>
          <label className={styles.field}>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </label>
          <label className={styles.field}>
            <span>Mobile number</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300 1234567" inputMode="tel" autoComplete="tel" required />
          </label>
          <label className={styles.field}>
            <span>Email <em>optional</em></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className={styles.field}>
            <span>Special occasion <em>optional</em></span>
            <input value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Birthday, anniversary…" />
          </label>
          <label className={styles.field}>
            <span>Anything we should know? <em>optional</em></span>
            <textarea value={requests} onChange={(e) => setRequests(e.target.value)} rows={2} />
          </label>
        </fieldset>
      </div>

      <aside className={styles.summary}>
        <h2 className={`display ${styles.summaryHeading}`}>Your table</h2>

        <dl className={styles.summaryList}>
          <div><dt>Date</dt><dd>{new Date(`${date}T12:00:00`).toLocaleDateString("en-PK", { weekday: "short", day: "numeric", month: "short" })}</dd></div>
          <div><dt>Guests</dt><dd>{partySize}</dd></div>
          <div><dt>Time</dt><dd>{chosen?.label ?? "—"}</dd></div>
        </dl>

        {error && !reviewing && <p className={styles.error}>{error}</p>}

        {alternatives.length > 0 && (
          <div className={styles.alts}>
            <p className={styles.altsHead}>Still free:</p>
            <div className={styles.slots}>
              {alternatives.map((a) => (
                <button
                  key={a.startsAt}
                  type="button"
                  className={styles.slot}
                  onClick={() => { setChosen(a); setAlternatives([]); setError(null); }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="submit" className={styles.primary} disabled={!detailsValid}>
          Review booking
        </button>
        <p className={styles.muted}>
          You&rsquo;ll see a summary before anything is held.
        </p>
      </aside>
    </form>
  );
}
