import Link from "next/link";
import { DishCard } from "@/components/dish-card";
import { JsonLd } from "@/components/json-ld";
import { SectionHead } from "@/components/section-head";
import { CAFE, directionsUrl } from "@/lib/cafe";
import {
  getByCategory,
  getItemBySlug,
  getPopular,
  getRecommended,
} from "@/lib/repositories/menu";
import { formatPKR } from "@/lib/money";
import { menuJsonLd, restaurantJsonLd } from "@/lib/seo";
import styles from "./page.module.css";

const WHY = [
  {
    title: "A short menu",
    body: "Fewer dishes, cooked properly. Everything on the board is something the kitchen wants to make.",
  },
  {
    title: "Breakfast all day",
    body: "Eggs at four in the afternoon are not a special request here. The griddle stays on until close.",
  },
  {
    title: "Coffee with intent",
    body: "House blend for milk drinks, a rotating single origin for filter, ground to order every time.",
  },
  {
    title: "Built for Bukhari",
    body: "Dine in, take away, or delivery across DHA. Scan the code at your table and order without waiting.",
  },
];

const REVIEWS = [
  {
    quote:
      "The only place in Phase 6 where I can get a proper flat white and a plate of eggs at 5pm without anyone raising an eyebrow.",
    name: "Sana R.",
    context: "Regular since opening",
  },
  {
    quote:
      "Ordered the chilli garlic spaghetti three times this month. The turkey bacon and the confit garlic do something unreasonable to it.",
    name: "Hamza A.",
    context: "Delivery, DHA Phase 5",
  },
  {
    quote:
      "Booked a table for eight on a Friday and they actually held it. Small thing, rare thing.",
    name: "Mariam K.",
    context: "Dined in",
  },
];

export default async function HomePage() {
  const [chefsPicks, popularItems, breakfastAll, coffee, desserts, signature] =
    await Promise.all([
      getRecommended(3),
      getPopular(6),
      getByCategory("Breakfast"),
      getByCategory("Hot Beverages"),
      getByCategory("Desserts"),
      getItemBySlug("chilli-garlic-chicken-spaghetti"),
    ]);
  const breakfast = breakfastAll.slice(0, 2);

  // Deduped by id so a dish featured above can't appear twice in the grid.
  const socialTiles = [
    ...(signature ? [signature] : []),
    ...desserts,
    ...breakfast,
    ...popularItems,
  ]
    .filter((item, i, all) => all.findIndex((x) => x.id === item.id) === i)
    .slice(0, 6);

  return (
    <>
      <JsonLd data={restaurantJsonLd()} />
      <JsonLd data={menuJsonLd()} />

      {/* ================= HERO ================= */}
      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.heroMedia} aria-hidden="true">
          <div className={styles.heroWash} />
          <div className={styles.heroGrain} />
        </div>

        <div className={`page ${styles.heroInner}`}>
          <p className={`eyebrow ${styles.heroEyebrow}`}>
            Bukhari Commercial · DHA Phase 6
          </p>

          {/* No hard <br>: forced breaks read well at one width and badly at
              every other. The line breaks are controlled by measure instead. */}
          <h1 id="hero-heading" className={`display ${styles.heroHeading}`}>
            Breakfast that doesn&rsquo;t watch{" "}
            <em className={styles.heroEm}>the clock.</em>
          </h1>

          <p className={styles.heroBody}>
            A modern gourmet kitchen in the heart of Bukhari. Eggs at four in the
            afternoon, coffee pulled slowly, and a short menu we actually cook
            properly.
          </p>

          <div className={styles.heroActions}>
            <Link href="/order" className={styles.btnPrimary}>
              Order Now
            </Link>
            <Link href="/reserve" className={styles.btnGhost}>
              Book a Table
            </Link>
            <Link href="/menu" className={styles.btnText}>
              View Menu →
            </Link>
          </div>
        </div>

        <div className={styles.heroMeta}>
          <span>
            Open today · {CAFE.hours[0]?.open} — {CAFE.hours[0]?.close}
          </span>
          <span className={styles.heroMetaDot} aria-hidden="true">
            ·
          </span>
          <span>Dine in · Takeaway · Delivery</span>
        </div>
      </section>

      {/* ================= CHEF'S PICKS ================= */}
      <section className={`page ${styles.section}`} aria-labelledby="picks">
        <SectionHead
          eyebrow="Featured"
          title={<span id="picks">What we&rsquo;d order</span>}
          lede="Three dishes the kitchen is proudest of this season."
          link={{ href: "/menu", label: "Full menu" }}
        />
        <div className={styles.grid3}>
          {chefsPicks.map((item) => (
            <DishCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      {/* ================= POPULAR RAIL ================= */}
      <section className={styles.sectionFlush} aria-labelledby="popular">
        <div className="page">
          <SectionHead
            eyebrow="Ordered most"
            title={<span id="popular">Popular this week</span>}
          />
        </div>
        {/* A rail rather than another grid — five near-identical grids down a
            homepage is what makes a site feel generated. */}
        <ul className={styles.rail} role="list">
          {popularItems.map((item) => (
            <li key={item.id} className={styles.railItem}>
              <DishCard item={item} />
            </li>
          ))}
        </ul>
      </section>

      {/* ================= BREAKFAST ================= */}
      <section className={`page ${styles.section}`} aria-labelledby="breakfast">
        <div className={styles.split}>
          <div className={styles.splitText}>
            <p className={`eyebrow ${styles.brassEyebrow}`}>All day, every day</p>
            <h2 id="breakfast" className={`display ${styles.splitHeading}`}>
              The griddle doesn&rsquo;t stop at eleven.
            </h2>
            <p className={styles.splitBody}>
              Most kitchens in Karachi close breakfast before the city has
              properly woken up. Ours runs from open to close — eggs, pancakes,
              shakshuka, the lot — because a plate of eggs is a perfectly
              reasonable dinner.
            </p>
            <Link href="/menu#breakfast" className={styles.inlineLink}>
              See the breakfast menu →
            </Link>
          </div>

          <div className={styles.splitCards}>
            {breakfast.map((item) => (
              <DishCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      </section>

      {/* ================= COFFEE ================= */}
      <section className={styles.coffeeBand} aria-labelledby="coffee">
        <div className={`page ${styles.coffeeInner}`}>
          <div className={styles.coffeeText}>
            <p className={`eyebrow ${styles.brassEyebrow}`}>The coffee</p>
            <h2 id="coffee" className={`display ${styles.coffeeHeading}`}>
              Ground to order, poured with patience.
            </h2>
            <p className={styles.splitBody}>
              A house blend built for milk — chocolate, brown sugar, low acidity
              — and a rotating single origin on filter for anyone who wants to
              taste where it came from.
            </p>
          </div>

          {/* A price list, not cards. Coffee doesn't need photographs, and the
              change of form breaks the rhythm of the page. */}
          <ul className={styles.coffeeList} role="list">
            {coffee.map((item) => (
              <li
                key={item.id}
                className={`${styles.coffeeRow} ${
                  !item.isAvailable ? styles.coffeeRowOff : ""
                }`}
              >
                <div className={styles.coffeeRowMain}>
                  <span className={styles.coffeeName}>{item.name}</span>
                  <span className={styles.coffeeDesc}>{item.description}</span>
                </div>
                <span className={`price ${styles.coffeePrice}`}>
                  {item.isAvailable ? formatPKR(item.price) : "Off today"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ================= DESSERTS ================= */}
      <section className={`page ${styles.section}`} aria-labelledby="desserts">
        <SectionHead
          eyebrow="Something sweet"
          title={<span id="desserts">Worth staying for</span>}
          lede="Two desserts, made in house, changed rarely."
          link={{ href: "/menu#desserts", label: "All desserts" }}
        />
        <div className={styles.grid2}>
          {desserts.map((item) => (
            <DishCard key={item.id} item={item} size="large" />
          ))}
        </div>
      </section>

      {/* ================= ABOUT ================= */}
      <section className={`page ${styles.section}`} aria-labelledby="about">
        <div className={styles.aboutWrap}>
          <p className={`eyebrow ${styles.brassEyebrow}`}>About</p>
          <h2 id="about" className={`display ${styles.aboutHeading}`}>
            {CAFE.tagline}
          </h2>
          <div className={styles.aboutCols}>
            <p>
              {CAFE.name} started with a short list of things we were tired of
              not finding in Phase 6: a flat white that isn&rsquo;t burnt,
              breakfast served past noon, and a room you can sit in for three
              hours without anyone hovering.
            </p>
            <p>
              The menu is deliberately small. We buy fresh, we prep daily, and
              when something runs out we take it off the board rather than
              cutting a corner. If the pour over is off today, that&rsquo;s why.
            </p>
          </div>
        </div>
      </section>

      {/* ================= WHY US ================= */}
      <section className={`page ${styles.section}`} aria-labelledby="why">
        <SectionHead eyebrow="Why us" title={<span id="why">What to expect</span>} />
        <ul className={styles.whyGrid} role="list">
          {WHY.map((item) => (
            <li key={item.title} className={styles.whyItem}>
              <h3 className={styles.whyTitle}>{item.title}</h3>
              <p className={styles.whyBody}>{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ================= REVIEWS ================= */}
      <section className={`page ${styles.section}`} aria-labelledby="reviews">
        <SectionHead
          eyebrow="Guestbook"
          title={<span id="reviews">What people say</span>}
          align="center"
        />
        <ul className={styles.reviewGrid} role="list">
          {REVIEWS.map((r) => (
            <li key={r.name}>
              <figure className={styles.review}>
                <blockquote className={styles.reviewQuote}>
                  &ldquo;{r.quote}&rdquo;
                </blockquote>
                <figcaption className={styles.reviewMeta}>
                  <span className={styles.reviewName}>{r.name}</span>
                  <span className={styles.reviewContext}>{r.context}</span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </section>

      {/* ================= LOCATION ================= */}
      <section className={`page ${styles.section}`} aria-labelledby="location">
        <div className={styles.locationWrap}>
          <div className={styles.locationText}>
            <p className={`eyebrow ${styles.brassEyebrow}`}>Find us</p>
            <h2 id="location" className={`display ${styles.locationHeading}`}>
              Lane 4, Bukhari Commercial.
            </h2>

            <address className={styles.locationAddress}>
              {CAFE.address.line1}
              <br />
              {CAFE.address.line2}
              <br />
              {CAFE.address.locality}, {CAFE.address.city}{" "}
              {CAFE.address.postalCode}
            </address>

            <dl className={styles.locationHours}>
              {CAFE.hours.map((h) => (
                <div key={h.days} className={styles.locationHourRow}>
                  <dt>{h.days}</dt>
                  <dd>
                    {h.open} — {h.close}
                  </dd>
                </div>
              ))}
            </dl>

            <div className={styles.locationActions}>
              <a
                href={directionsUrl()}
                target="_blank"
                rel="noreferrer"
                className={styles.btnPrimary}
              >
                Get Directions
              </a>
              {/* Deliberately not a tel: link — see lib/cafe.ts */}
              <span className={styles.phoneBlock}>
                <span className={styles.phoneLabel}>Call</span>
                <span className={styles.phoneNumber}>{CAFE.phoneDisplay}</span>
              </span>
            </div>
          </div>

          {/* Static map treatment. The Google Maps JS SDK is 100KB+ on the main
              thread and never loads on this page — the directions link above
              does the actual job. */}
          <div className={styles.mapCard} aria-hidden="true">
            <div className={styles.mapGrid} />
            <div className={styles.mapPin}>
              <span className={styles.mapPinDot} />
              <span className={styles.mapPinRing} />
            </div>
            <span className={styles.mapLabel}>Bukhari Commercial Area</span>
          </div>
        </div>
      </section>

      {/* ================= SOCIAL ================= */}
      <section className={`page ${styles.section}`} aria-labelledby="social">
        <SectionHead
          eyebrow="@gooteecafe"
          title={<span id="social">From the pass</span>}
          lede="Daily specials, what's on filter, and the occasional dog on the terrace."
          link={{ href: CAFE.social.instagram, label: "Follow" }}
        />
        {/* Exactly six — the grid is 6-up on wide screens and a short row
            leaves a visible hole at the end. */}
        <ul className={styles.socialGrid} role="list">
          {socialTiles.map((item) => (
            <li key={item.id} className={styles.socialTile}>
              <span className={styles.socialMark}>{item.name.charAt(0)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
