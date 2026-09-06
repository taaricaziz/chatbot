import Link from "next/link";
import { CAFE, formattedAddress, directionsUrl } from "@/lib/cafe";
import styles from "./site-footer.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <span className={`display ${styles.brandName}`}>{CAFE.name}</span>
          <p className={styles.tagline}>{CAFE.tagline}</p>
        </div>

        <div className={styles.col}>
          <h2 className={`eyebrow ${styles.colHead}`}>Visit</h2>
          <address className={styles.address}>
            {CAFE.address.line1}
            <br />
            {CAFE.address.line2}
            <br />
            {CAFE.address.locality}, {CAFE.address.city} {CAFE.address.postalCode}
          </address>
          <a
            className={styles.link}
            href={directionsUrl()}
            target="_blank"
            rel="noreferrer"
          >
            Get directions →
          </a>
        </div>

        <div className={styles.col}>
          <h2 className={`eyebrow ${styles.colHead}`}>Hours</h2>
          <dl className={styles.hours}>
            {CAFE.hours.map((h) => (
              <div key={h.days} className={styles.hourRow}>
                <dt>{h.days}</dt>
                <dd>
                  {h.open} — {h.close}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className={styles.col}>
          <h2 className={`eyebrow ${styles.colHead}`}>Contact</h2>
          {/* Rendered as text, not a tel: link — see the note in lib/cafe.ts */}
          <p className={styles.phone}>{CAFE.phoneDisplay}</p>
          <p className={styles.muted}>{CAFE.email}</p>
          <div className={styles.socials}>
            <a
              className={styles.link}
              href={CAFE.social.instagram}
              target="_blank"
              rel="noreferrer"
            >
              Instagram
            </a>
            <a
              className={styles.link}
              href={CAFE.social.facebook}
              target="_blank"
              rel="noreferrer"
            >
              Facebook
            </a>
          </div>
        </div>
      </div>

      <div className={styles.baseline}>
        <p className={styles.demoNotice}>{CAFE.demoNotice}</p>
        <nav className={styles.baselineNav} aria-label="Footer">
          <Link className={styles.link} href="/menu">
            Menu
          </Link>
          <Link className={styles.link} href="/reserve">
            Reservations
          </Link>
          <Link className={styles.link} href="/contact">
            Contact
          </Link>
        </nav>
      </div>

      <p className="visually-hidden">{formattedAddress()}</p>
    </footer>
  );
}
