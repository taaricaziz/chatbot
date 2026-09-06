import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CAFE } from "@/lib/cafe";
import { formatPKR } from "@/lib/money";
import { getSessionBill, SessionError } from "@/lib/services/table-sessions";
import styles from "./bill.module.css";

export const metadata: Metadata = {
  title: "Your bill",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export default async function BillPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let bill;
  try {
    bill = await getSessionBill(token);
  } catch (error) {
    if (error instanceof SessionError) notFound();
    throw error;
  }

  return (
    <section className={`page ${styles.wrap}`}>
      <div className={styles.header}>
        <p className={`eyebrow ${styles.eyebrow}`}>
          Table {bill.session.tableLabel}
        </p>
        <h1 className={`display ${styles.title}`}>Your bill</h1>
        <p className={styles.lede}>
          Open since {timeOf(bill.session.openedAt)}
          {bill.roundCount > 0 && (
            <>
              {" · "}
              {bill.roundCount} {bill.roundCount === 1 ? "round" : "rounds"}
              {" · "}
              {bill.itemCount} {bill.itemCount === 1 ? "item" : "items"}
            </>
          )}
        </p>
      </div>

      {bill.rounds.length === 0 ? (
        <div className={styles.empty}>
          <p className={`display ${styles.emptyHeading}`}>
            Nothing ordered yet.
          </p>
          <p className={styles.emptyBody}>
            Anything you send to the kitchen will appear here, round by round.
          </p>
          <Link href={`/t/${token}`} className={styles.primary}>
            Back to the menu
          </Link>
        </div>
      ) : (
        <>
          <ol className={styles.rounds} role="list">
            {bill.rounds.map((round, i) => (
              <li key={round.orderNumber} className={styles.round}>
                <div className={styles.roundHead}>
                  <span className={styles.roundNum}>Round {i + 1}</span>
                  <span className={styles.roundMeta}>
                    {timeOf(round.placedAt)} · {round.orderNumber}
                  </span>
                  <span className={styles.roundStatus}>{round.status}</span>
                </div>
                <ul className={styles.roundItems} role="list">
                  {round.items.map((item, j) => (
                    <li key={`${item.name}-${j}`}>
                      <span>
                        {item.quantity} &times; {item.name}
                      </span>
                      <span className="price">
                        {formatPKR(item.lineTotalPaisa)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <dl className={styles.totals}>
            <div className={styles.totalRow}>
              <dt>Subtotal</dt>
              <dd>{formatPKR(bill.subtotalPaisa)}</dd>
            </div>
            <div className={styles.totalRow}>
              <dt>Service tax</dt>
              <dd>{formatPKR(bill.taxPaisa)}</dd>
            </div>
            <div className={`${styles.totalRow} ${styles.grand}`}>
              <dt>Total so far</dt>
              <dd className="price">{formatPKR(bill.totalPaisa)}</dd>
            </div>
          </dl>

          {/* Tax is summed across rounds, not recomputed on the total — each
              round was taxed at the rate applying when it was placed. */}
          <p className={styles.settle}>
            Settle at the counter when you&rsquo;re ready. Card and wallet
            payments are taxed at 8% instead of 15%, so the final figure may
            come down a little.
          </p>

          <div className={styles.actions}>
            <Link href={`/t/${token}`} className={styles.primary}>
              Order more
            </Link>
          </div>
        </>
      )}

      <p className={styles.help}>
        Need a hand? Ask any member of staff, or call {CAFE.phoneDisplay}.
      </p>
    </section>
  );
}
