import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { CAFE, directionsUrl, formattedAddress } from "@/lib/cafe";
import { restaurantJsonLd } from "@/lib/seo";
import styles from "./contact.module.css";

export const metadata: Metadata = {
  title: "Contact & Location",
  description: `Find ${CAFE.name} at ${formattedAddress()}. Opening hours, directions and contact details.`,
};

export default function ContactPage() {
  return (
    <>
      <JsonLd data={restaurantJsonLd()} />

      <section className={`page ${styles.intro}`}>
        <p className={`eyebrow ${styles.eyebrow}`}>Contact</p>
        <h1 className={`display ${styles.title}`}>Find us in Bukhari.</h1>
        <p className={styles.lede}>
          Lane 4, a minute off Khayaban-e-Shujaat. Street parking along the
          commercial strip.
        </p>
      </section>

      <section className={`page ${styles.grid}`}>
        <div className={styles.detailCol}>
          <div className={styles.block}>
            <h2 className={`eyebrow ${styles.blockHead}`}>Address</h2>
            <address className={styles.address}>
              {CAFE.address.line1}
              <br />
              {CAFE.address.line2}
              <br />
              {CAFE.address.locality}, {CAFE.address.city}{" "}
              {CAFE.address.postalCode}
            </address>
            <a
              className={styles.primary}
              href={directionsUrl()}
              target="_blank"
              rel="noreferrer"
            >
              Get Directions
            </a>
          </div>

          <div className={styles.block}>
            <h2 className={`eyebrow ${styles.blockHead}`}>Hours</h2>
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
            <p className={styles.note}>
              Kitchen closes thirty minutes before the room does.
            </p>
          </div>

          <div className={styles.block}>
            <h2 className={`eyebrow ${styles.blockHead}`}>Get in touch</h2>
            {/* Rendered as text, never a tel: link — see lib/cafe.ts */}
            <p className={styles.phone}>{CAFE.phoneDisplay}</p>
            <p className={styles.email}>{CAFE.email}</p>
            <div className={styles.socials}>
              <a href={CAFE.social.instagram} target="_blank" rel="noreferrer">
                Instagram
              </a>
              <a href={CAFE.social.facebook} target="_blank" rel="noreferrer">
                Facebook
              </a>
            </div>
          </div>
        </div>

        {/* Static treatment. The interactive Google embed is the one place it
            would be justified, but it stays lazy and off the critical path —
            the directions link above is what people actually use. */}
        <div className={styles.mapCard}>
          <div className={styles.mapGrid} aria-hidden="true" />
          <div className={styles.mapPin} aria-hidden="true">
            <span className={styles.mapPinDot} />
            <span className={styles.mapPinRing} />
          </div>
          <div className={styles.mapCaption}>
            <span className={styles.mapCaptionName}>{CAFE.name}</span>
            <span className={styles.mapCaptionAddr}>
              Bukhari Commercial Area, Phase 6
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
