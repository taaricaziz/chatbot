/**
 * Canonical café details — the single source of truth for name, address and
 * phone (NAP). Every surface that displays contact information reads from
 * here: the header, the footer, the contact page, the location section and
 * the LocalBusiness structured data.
 *
 * Inconsistent NAP data across a site is the one local-SEO mistake that
 * actively hurts rather than merely failing to help, so this is never
 * retyped per page.
 *
 * NOTE: This is a demonstration build. The address and phone below are
 * deliberately fictional — see the architecture plan. The reference café
 * (Xander's DHA Bukhari) is research material only; none of its contact
 * details appear anywhere in this codebase. The phone number uses
 * sequential digits so it reads as illustrative, and it is rendered as
 * plain text with no `tel:` link so it cannot be dialled by accident.
 */

export const CAFE = {
  name: "Gootee Cafe",
  descriptor: "All-Day Kitchen, DHA Phase 6",
  tagline: "Simple things, done properly.",

  address: {
    line1: "Plot 14-C, Lane 4",
    line2: "Bukhari Commercial Area",
    locality: "Phase 6, DHA",
    city: "Karachi",
    postalCode: "75500",
    country: "PK",
  },

  /** Rendered as text only — intentionally not a tel: link. See note above. */
  phoneDisplay: "+92 21 3456 7890",
  email: "hello@gooteecafe.example",

  /** Map centres on Bukhari Commercial so the location section behaves as in production. */
  geo: { lat: 24.8007, lng: 67.0714 },

  hours: [
    { days: "Monday — Thursday", open: "08:00", close: "00:00" },
    { days: "Friday — Sunday", open: "08:00", close: "01:00" },
  ],

  social: {
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/",
  },

  /** Shown in the footer so the site is never mistaken for a live business. */
  demoNotice:
    "This is a demonstration website. Gootee Cafe is not a real business — the address, phone number and menu are illustrative.",
} as const;

/** Single-line address, for meta descriptions and structured data. */
export function formattedAddress(): string {
  const a = CAFE.address;
  return `${a.line1}, ${a.line2}, ${a.locality}, ${a.city} ${a.postalCode}`;
}

/**
 * Google Maps directions deep link. Deliberately a plain URL rather than the
 * Maps JS SDK — the SDK is 100KB+ on the main thread, and this gives
 * identical utility on a page already carrying heavy food photography.
 */
export function directionsUrl(): string {
  const destination = encodeURIComponent(
    `${CAFE.name}, ${formattedAddress()}`,
  );
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}
