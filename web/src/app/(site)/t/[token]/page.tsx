import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DishCard } from "@/components/dish-card";
import { TableBar } from "@/components/table/table-bar";
import { TableSessionBoot } from "@/components/table/table-session-boot";
import { getCategories, getMenu } from "@/lib/repositories/menu";
import { SessionError, startSession } from "@/lib/services/table-sessions";
import styles from "./table.module.css";

export const metadata: Metadata = {
  title: "Order at your table",
  // A table URL is private to whoever is sitting there. Keep it out of search.
  robots: { index: false, follow: false },
};

// Session state changes constantly; never cache this page.
export const dynamic = "force-dynamic";

export default async function TablePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let session;
  let tableLabel: string;
  try {
    const started = await startSession(token);
    session = started.session;
    tableLabel = started.tableLabel;
  } catch (error) {
    if (error instanceof SessionError) notFound();
    throw error;
  }

  const [items, categories] = await Promise.all([getMenu(), getCategories()]);
  const available = items.filter((i) => i.isAvailable);

  return (
    <>
      <TableSessionBoot sessionId={session.id} tableLabel={tableLabel} token={token} />

      <section className={`page ${styles.intro}`}>
        <p className={`eyebrow ${styles.eyebrow}`}>Table {tableLabel}</p>
        <h1 className={`display ${styles.title}`}>What can we get you?</h1>
        <p className={styles.lede}>
          Add what you want and send it to the kitchen. Order as many rounds as
          you like &mdash; it all goes on one bill, settled at the counter when
          you&rsquo;re done.
        </p>
        <Link href={`/t/${token}/bill`} className={styles.billLink}>
          View the bill so far &rarr;
        </Link>
      </section>

      <div className={`page ${styles.menu}`}>
        {categories.map((cat) => {
          const catItems = available.filter((i) => i.category === cat.name);
          if (catItems.length === 0) return null;
          return (
            <section key={cat.name} className={styles.catSection}>
              <h2 className={`display ${styles.catHeading}`}>{cat.name}</h2>
              <div className={styles.grid}>
                {catItems.map((item) => (
                  <DishCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <TableBar token={token} tableLabel={tableLabel} sessionId={session.id} />
    </>
  );
}
