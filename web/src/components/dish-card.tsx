import Link from "next/link";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import type { MenuItem } from "@/lib/menu-seed";
import { formatPKR } from "@/lib/money";
import styles from "./dish-card.module.css";

/**
 * Deterministic hue per item, so the same dish always gets the same
 * treatment and the grid reads as a considered set rather than random.
 */
function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  // Constrained to the warm arc — amber through to deep russet. A full
  // 0–360 spread would put cold blues and pinks next to the food.
  return 18 + (h % 44);
}

/**
 * PHASE 4 NOTE: this is the photography slot. Real 4:3 food images replace
 * `DishMedia` wholesale — the card layout, dimensions and aspect ratio are
 * already final so the swap causes no layout shift.
 */
function DishMedia({ item }: { item: MenuItem }) {
  const hue = hueFor(item.id);
  return (
    <div
      className={styles.media}
      aria-hidden="true"
      style={
        {
          "--dish-hue": hue,
        } as React.CSSProperties
      }
    >
      <span className={styles.mediaMark}>{item.name.charAt(0)}</span>
    </div>
  );
}

/** At most one badge. Two competing claims on the same card is noise, and
 *  "chef's pick" is the stronger signal, so it wins over "popular". */
function Badges({ item }: { item: MenuItem }) {
  if (!item.isRecommended && !item.isPopular) return null;

  const isChef = item.isRecommended;

  return (
    <div className={styles.badges}>
      <span
        className={`${styles.badge} ${
          isChef ? styles.badgeChef : styles.badgePopular
        }`}
      >
        {isChef ? "Chef's pick" : "Popular"}
      </span>
    </div>
  );
}

/** Dietary markers sit with the name, not in the badge row — they answer a
 *  different question ("can I eat this?") than a recommendation does. */
function Diet({ item }: { item: MenuItem }) {
  return (
    <span className={styles.diet}>
      {item.isVegetarian && (
        <span className={styles.veg} title="Vegetarian">
          <span className="visually-hidden">Vegetarian</span>
        </span>
      )}
      {item.isSpicy && (
        <span className={styles.spicy} title="Spicy">
          <span className="visually-hidden">Spicy</span>
        </span>
      )}
    </span>
  );
}

export function DishCard({
  item,
  size = "regular",
}: {
  item: MenuItem;
  size?: "regular" | "large";
}) {
  const soldOut = !item.isAvailable;

  return (
    <article
      className={`${styles.card} ${size === "large" ? styles.large : ""} ${
        soldOut ? styles.soldOut : ""
      }`}
    >
      <div className={styles.mediaWrap}>
        <DishMedia item={item} />
        <Badges item={item} />
        {soldOut && <span className={styles.soldOutTag}>Sold out today</span>}
      </div>

      <div className={styles.body}>
        <div className={styles.headRow}>
          <h3 className={styles.name}>
            <Link href={`/menu/${item.slug}`} className={styles.nameLink}>
              {item.name}
            </Link>
          </h3>
          <Diet item={item} />
        </div>

        <p className={styles.description}>{item.description}</p>

        <div className={styles.footRow}>
          <span className={`price ${styles.price}`}>
            {formatPKR(item.price)}
          </span>
          <AddToCartButton
            slug={item.slug}
            name={item.name}
            disabled={soldOut}
          />
        </div>
      </div>
    </article>
  );
}
