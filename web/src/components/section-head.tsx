import Link from "next/link";
import styles from "./section-head.module.css";

export function SectionHead({
  eyebrow,
  title,
  lede,
  link,
  align = "start",
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: string;
  link?: { href: string; label: string };
  align?: "start" | "center";
}) {
  return (
    <header
      className={`${styles.head} ${align === "center" ? styles.center : ""}`}
    >
      <div className={styles.textCol}>
        <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p>
        <h2 className={`display ${styles.title}`}>{title}</h2>
        {lede && <p className={styles.lede}>{lede}</p>}
      </div>

      {link && (
        <Link href={link.href} className={styles.link}>
          {link.label} <span aria-hidden="true">→</span>
        </Link>
      )}
    </header>
  );
}
