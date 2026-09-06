import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { JsonLd } from "@/components/json-ld";
import { getAllSlugs, getItemBySlug, getRelated } from "@/lib/repositories/menu";
import { formatPKR } from "@/lib/money";
import { CAFE } from "@/lib/cafe";
import styles from "./dish.module.css";

const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

export async function generateStaticParams() {
  const slugs = await getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const item = await getItemBySlug(slug);
  if (!item) return { title: "Not found" };

  return {
    title: item.name,
    description: item.description,
    alternates: { canonical: `${base}/menu/${item.slug}` },
    openGraph: {
      title: `${item.name} · ${CAFE.name}`,
      description: item.description,
      type: "article",
    },
  };
}

export default async function DishPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = await getItemBySlug(slug);
  if (!item) notFound();

  const related = await getRelated(item, 3);

  const hue = (() => {
    let h = 0;
    for (const ch of item.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return 18 + (h % 44);
  })();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
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
        }}
      />

      <article className={`page ${styles.wrap}`}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link href="/menu">Menu</Link>
          <span aria-hidden="true">/</span>
          <span className={styles.crumbCurrent}>{item.category}</span>
        </nav>

        <div className={styles.grid}>
          {/* PHASE 4 NOTE: photography slot. Aspect ratio is final. */}
          <div
            className={styles.media}
            aria-hidden="true"
            style={{ "--dish-hue": hue } as React.CSSProperties}
          >
            <span className={styles.mediaMark}>{item.name.charAt(0)}</span>
          </div>

          <div className={styles.detail}>
            <p className={`eyebrow ${styles.category}`}>{item.category}</p>
            <h1 className={`display ${styles.name}`}>{item.name}</h1>

            <p className={styles.description}>{item.description}</p>

            <div className={styles.markers}>
              {item.isVegetarian && (
                <span className={`${styles.marker} ${styles.veg}`}>
                  Vegetarian
                </span>
              )}
              {item.isSpicy && (
                <span className={`${styles.marker} ${styles.spicy}`}>Spicy</span>
              )}
              {item.isRecommended && (
                <span className={`${styles.marker} ${styles.chef}`}>
                  Chef&rsquo;s pick
                </span>
              )}
            </div>

            <div className={styles.buyRow}>
              <span className={`price ${styles.price}`}>
                {formatPKR(item.price)}
              </span>
              <AddToCartButton
                slug={item.slug}
                name={item.name}
                disabled={!item.isAvailable}
                variant="full"
              />
            </div>

            <p className={styles.note}>
              Extras and customisation options arrive with the item’s modifier set.
            </p>
          </div>
        </div>

        {related.length > 0 && (
          <section className={styles.related}>
            <h2 className={`eyebrow ${styles.relatedHead}`}>
              More {item.category}
            </h2>
            <ul className={styles.relatedList} role="list">
              {related.map((r) => (
                <li key={r.id}>
                  <Link href={`/menu/${r.slug}`} className={styles.relatedLink}>
                    <span className={styles.relatedName}>{r.name}</span>
                    <span className={`price ${styles.relatedPrice}`}>
                      {formatPKR(r.price)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </>
  );
}
