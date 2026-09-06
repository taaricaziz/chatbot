import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { MenuBrowser } from "@/components/menu-browser";
import { CAFE } from "@/lib/cafe";
import { getCategories, getMenu } from "@/lib/repositories/menu";
import { menuJsonLd } from "@/lib/seo";
import styles from "./menu.module.css";

export const metadata: Metadata = {
  title: "The Menu",
  description:
    "All-day breakfast, pasta, burgers, salads, coffee and desserts. The full menu at Gootee Cafe, Bukhari Commercial, DHA Phase 6, Karachi — with prices in Rupees.",
};

export default async function MenuPage() {
  // Every item is rendered server-side, so the whole menu is in the HTML for
  // search engines. Filtering happens client-side on data that is already
  // there — no loading spinner, no round trip.
  const [items, categories] = await Promise.all([getMenu(), getCategories()]);

  return (
    <>
      <JsonLd data={menuJsonLd()} />

      <section className={`page ${styles.intro}`}>
        <p className={`eyebrow ${styles.eyebrow}`}>The Menu</p>
        <h1 className={`display ${styles.title}`}>
          Everything we cook, on one page.
        </h1>
        <p className={styles.lede}>
          {items.length} dishes across {categories.length} sections. Prices in
          Rupees, inclusive of nothing — tax is added at checkout and depends on
          how you pay.
        </p>
      </section>

      <div className={`page ${styles.browserWrap}`}>
        <MenuBrowser items={items} categories={categories} />
      </div>

      <section className={`page ${styles.footNote}`}>
        <p>
          Allergen information is on each dish page. If you have a serious
          allergy, tell the floor staff at {CAFE.name} before ordering — the
          kitchen is small and not all preparation is separated.
        </p>
      </section>
    </>
  );
}
