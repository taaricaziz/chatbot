import type { Metadata } from "next";
import { Bodoni_Moda, Karla } from "next/font/google";
import { CAFE } from "@/lib/cafe";
import "./globals.css";

/**
 * Root layout — the document shell and nothing else.
 *
 * The customer header, footer and cart live in `(site)/layout.tsx`; the staff
 * console has its own in `admin/layout.tsx`. Keeping them apart is why the
 * console does not wear the café's navigation, and why a staff member is not
 * carrying a shopping cart around the orders queue.
 */

const display = Bodoni_Moda({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const body = Karla({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${CAFE.name} — ${CAFE.descriptor}`,
    template: `%s · ${CAFE.name}`,
  },
  description:
    "A modern gourmet cafe in Bukhari Commercial, DHA Phase 6, Karachi. All-day breakfast, slow coffee, and a kitchen that keeps it simple and fresh.",
  openGraph: {
    type: "website",
    locale: "en_PK",
    siteName: CAFE.name,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
