import Link from "next/link";
import styles from "./coming-soon.module.css";

/**
 * Honest placeholder for routes the build sequence hasn't reached yet.
 *
 * The primary nav links to six routes; without this, five of them 404 and
 * the site reads as broken rather than as in-progress. Deleted route by
 * route as each phase lands.
 */
export function ComingSoon({
  title,
  phase,
  body,
}: {
  title: string;
  phase: string;
  body: string;
}) {
  return (
    <section className={`page ${styles.wrap}`}>
      <p className={`eyebrow ${styles.eyebrow}`}>{phase}</p>
      <h1 className={`display ${styles.title}`}>{title}</h1>
      <p className={styles.body}>{body}</p>
      <div className={styles.actions}>
        <Link href="/" className={styles.primary}>
          Back to home
        </Link>
        <Link href="/contact" className={styles.ghost}>
          Contact us
        </Link>
      </div>
    </section>
  );
}
