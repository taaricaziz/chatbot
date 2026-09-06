import type { Metadata } from "next";
import Link from "next/link";
import { CAFE } from "@/lib/cafe";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "About",
  description: `${CAFE.tagline} A modern gourmet café in Bukhari Commercial, DHA Phase 6, Karachi — all-day breakfast, slow coffee and a deliberately short menu.`,
};

const PRINCIPLES = [
  {
    n: "Buy fresh, prep daily",
    body: "Produce arrives every morning. Nothing is portioned more than a day ahead, which is why the board occasionally gets shorter as the evening goes on.",
  },
  {
    n: "Cook a short list well",
    body: "A long menu is a promise most kitchens can't keep. Ours fits on one page so every dish gets the attention it needs.",
  },
  {
    n: "Take the table off the clock",
    body: "Nobody will hover. If you want to sit with a cortado and a laptop for three hours, that is what the corner seats are for.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className={`page ${styles.intro}`}>
        <p className={`eyebrow ${styles.eyebrow}`}>About</p>
        <h1 className={`display ${styles.title}`}>{CAFE.tagline}</h1>
        <p className={styles.lede}>
          {CAFE.name} opened in Bukhari Commercial with a short list of
          complaints and a shorter menu.
        </p>
      </section>

      <section className={`page ${styles.story}`}>
        <div className={styles.storyCols}>
          <p>
            The complaints were specific. Flat whites that tasted burnt. Kitchens
            that stopped serving eggs at eleven in the morning, as though nobody
            in Karachi keeps late hours. Rooms designed to turn a table in
            forty-five minutes.
          </p>
          <p>
            So the brief was simple: a house blend built for milk, a griddle that
            stays on from open to close, and enough seats that we never need to
            rush anyone out of one. Everything else followed from that.
          </p>
          <p>
            The menu is deliberately small — around sixty things, not two
            hundred. We would rather cook a short list properly than offer a long
            one badly. When something runs out, it comes off the board. That is
            the trade.
          </p>
          <p>
            The room seats forty inside and sixteen on the terrace. Mornings are
            quiet and good for working. Evenings are not. Both are on purpose.
          </p>
        </div>
      </section>

      <section className={`page ${styles.principles}`}>
        <h2 className={`display ${styles.sectionTitle}`}>How we work</h2>
        <ol className={styles.principleList} role="list">
          {PRINCIPLES.map((p, i) => (
            <li key={p.n} className={styles.principle}>
              {/* Numbered because these are ordered by priority — the first
                  constrains the second, the second the third. */}
              <span className={styles.principleNum}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className={styles.principleBody}>
                <h3 className={styles.principleTitle}>{p.n}</h3>
                <p className={styles.principleText}>{p.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={`page ${styles.cta}`}>
        <h2 className={`display ${styles.ctaTitle}`}>Come and sit down.</h2>
        <div className={styles.ctaActions}>
          <Link href="/reserve" className={styles.primary}>
            Book a Table
          </Link>
          <Link href="/menu" className={styles.ghost}>
            View the Menu
          </Link>
        </div>
      </section>
    </>
  );
}
