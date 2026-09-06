import type { Metadata } from "next";
import { ReserveForm } from "@/components/reserve/reserve-form";
import { CAFE } from "@/lib/cafe";
import styles from "./reserve.module.css";

export const metadata: Metadata = {
  title: "Book a Table",
  description: `Reserve a table at ${CAFE.name}, Bukhari Commercial, DHA Phase 6, Karachi. Indoor seating and a terrace, open from 8am.`,
};

export default function ReservePage() {
  return (
    <section className={`page ${styles.wrap}`}>
      <div className={styles.intro}>
        <p className={`eyebrow ${styles.eyebrow}`}>Reservations</p>
        <h1 className={`display ${styles.title}`}>Book a table</h1>
        <p className={styles.lede}>
          Forty seats inside and sixteen on the terrace. We hold bookings for
          fifteen minutes past the time &mdash; after that the table goes back
          into the room.
        </p>
      </div>
      <ReserveForm />
    </section>
  );
}
