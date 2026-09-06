import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { signOut } from "@/lib/services/admin-actions";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: { default: "Console", template: "%s · Gootee Console" },
  // The console must never be indexed, whatever the crawler does with robots.txt.
  robots: { index: false, follow: false, nocache: true },
};

const NAV = [
  { href: "/admin", label: "Today" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/floor", label: "Floor" },
  { href: "/admin/reservations", label: "Bookings" },
  { href: "/admin/menu", label: "Menu" },
  { href: "/admin/notifications", label: "Messages" },
  { href: "/admin/conversations", label: "Assistant" },
  { href: "/admin/tables", label: "QR codes" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  // The login page renders inside this layout too, so the chrome is only
  // drawn once there is somebody to draw it for.
  if (!session) return <>{children}</>;

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/admin" className={styles.brand}>
          <span className={`display ${styles.brandName}`}>Gootee</span>
          <span className={styles.brandTag}>Console</span>
        </Link>

        <nav className={styles.nav} aria-label="Console">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.who}>
          <span className={styles.whoName}>{session.name}</span>
          <span className={styles.whoRole}>{session.role}</span>
          <form action={signOut}>
            <button type="submit" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
