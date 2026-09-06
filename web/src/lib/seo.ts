import { CAFE } from "./cafe";
import { MENU } from "./menu-seed";

const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

/**
 * Structured data. The address here and the address rendered on the page come
 * from the same constant, which is the point — a LocalBusiness schema that
 * disagrees with the visible NAP is worse than no schema at all.
 */
export function restaurantJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${base}/#restaurant`,
    name: CAFE.name,
    description: `${CAFE.descriptor}. ${CAFE.tagline}`,
    url: base,
    servesCuisine: ["Cafe", "Breakfast", "Continental"],
    priceRange: "Rs. 380 – Rs. 2,690",
    acceptsReservations: true,
    address: {
      "@type": "PostalAddress",
      streetAddress: `${CAFE.address.line1}, ${CAFE.address.line2}`,
      addressLocality: CAFE.address.locality,
      addressRegion: CAFE.address.city,
      postalCode: CAFE.address.postalCode,
      addressCountry: CAFE.address.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: CAFE.geo.lat,
      longitude: CAFE.geo.lng,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday"],
        opens: "08:00",
        closes: "23:59",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Friday", "Saturday", "Sunday"],
        opens: "08:00",
        closes: "23:59",
      },
    ],
    hasMenu: `${base}/menu`,
  };
}

export function menuJsonLd() {
  const categories = [...new Set(MENU.map((i) => i.category))];

  return {
    "@context": "https://schema.org",
    "@type": "Menu",
    "@id": `${base}/menu#menu`,
    name: `${CAFE.name} Menu`,
    inLanguage: "en-PK",
    hasMenuSection: categories.map((category) => ({
      "@type": "MenuSection",
      name: category,
      hasMenuItem: MENU.filter((i) => i.category === category).map((item) => ({
        "@type": "MenuItem",
        name: item.name,
        description: item.description,
        offers: {
          "@type": "Offer",
          price: (item.price / 100).toFixed(0),
          priceCurrency: "PKR",
          availability: item.isAvailable
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        },
        suitableForDiet: item.isVegetarian
          ? ["https://schema.org/VegetarianDiet"]
          : undefined,
      })),
    })),
  };
}
