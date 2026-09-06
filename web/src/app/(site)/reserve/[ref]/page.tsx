import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CAFE, directionsUrl } from "@/lib/cafe";
import { getReservation } from "@/lib/services/reservations";
import styles from "./confirmation.module.css";

export const metadata: Metadata = {
  title: "Booking received",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; note: string }> = {
  PENDING: {
    label: "Awaiting confirmation",
    note: "The café confirms bookings by hand, usually within a couple of hours. We'll text you.",
  },
  CONFIRMED: {
    label: "Confirmed",
    note: "Your table is held. See you then.",
  },
  SEATED: { label: "Seated", note: "Enjoy your meal." },
  COMPLETED: { label: "Completed", note: "Thanks for coming in." },
  CANCELLED: { label: "Cancelled", note: "This booking has been cancelled." },
  NO_SHOW: { label: "Missed", note: "This table was held but not taken." },
};

export default async function ReservationPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const booking = await getReservation(ref);
  if (!booking) notFound();

  const when = new Date(booking.startsAt);
  const status = STATUS_COPY[booking.status] ?? STATUS_COPY.PENDING!;

  return (
    <section className={`page ${styles.wrap}`}>
      <div className={styles.header}>
        <p className={`eyebrow ${styles.eyebrow}`}>Booking received</p>
        <h1 className={`display ${styles.reference}`}>{booking.reference}</h1>
        <p className={styles.statusLine}>
          <span className={styles.statusChip}>{status.label}</span>
          {status.note}
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h2 className={`eyebrow ${styles.cardHead}`}>Your table</h2>
          <dl className={styles.details}>
            <div>
              <dt>Date</dt>
              <dd>
                {when.toLocaleDateString("en-PK", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>
                {when.toLocaleTimeString("en-PK", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                })}
              </dd>
            </div>
            <div>
              <dt>Guests</dt>
              <dd>{booking.partySize}</dd>
            </div>
            <div>
              <dt>Seating</dt>
              <dd>
                {booking.seating === "ANY"
                  ? "No preference"
                  : booking.seating === "INDOOR"
                    ? "Indoor"
                    : "Terrace"}
              </dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{booking.guestName}</dd>
            </div>
            {booking.occasion && (
              <div>
                <dt>Occasion</dt>
                <dd>{booking.occasion}</dd>
              </div>
            )}
          </dl>

          {booking.requests && (
            <>
              <h2 className={`eyebrow ${styles.cardHead}`}>Your note</h2>
              <p className={styles.requests}>{booking.requests}</p>
            </>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={`eyebrow ${styles.cardHead}`}>Where</h2>
          <address className={styles.address}>
            {CAFE.name}
            <br />
            {CAFE.address.line1}
            <br />
            {CAFE.address.line2}
            <br />
            {CAFE.address.locality}, {CAFE.address.city} {CAFE.address.postalCode}
          </address>
          <a className={styles.link} href={directionsUrl()} target="_blank" rel="noreferrer">
            Get directions &rarr;
          </a>

          <h2 className={`eyebrow ${styles.cardHead}`}>If plans change</h2>
          <ul className={styles.policy}>
            <li>
              We hold the table for <strong>15 minutes</strong> past your time,
              then release it.
            </li>
            <li>
              To change or cancel, call {CAFE.phoneDisplay} and quote{" "}
              <strong>{booking.reference}</strong>.
            </li>
            <li>
              For parties of eight or more, please give us a day&rsquo;s notice
              if you need to cancel.
            </li>
          </ul>
        </div>
      </div>

      <div className={styles.actions}>
        <Link href="/menu" className={styles.primary}>
          Have a look at the menu
        </Link>
      </div>
    </section>
  );
}
