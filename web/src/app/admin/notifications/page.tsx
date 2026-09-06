import { requireStaff } from "@/lib/auth";
import { listRecent } from "@/lib/repositories/notifications";
import { renderTemplate } from "@/lib/services/notifications";
import { providerFor } from "@/lib/notifications/dispatch";
import styles from "./notifications.module.css";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireStaff("MANAGER");
  const messages = await listRecent(40);

  const pending = messages.filter(
    (m) => m.status === "PENDING" || m.status === "FAILED",
  ).length;
  const dead = messages.filter((m) => m.status === "DEAD").length;

  const emailProvider = providerFor("EMAIL").name;
  const smsProvider = providerFor("SMS").name;

  return (
    <>
      <div className={styles.head}>
        <h1 className={`display ${styles.title}`}>Messages</h1>
        <p className={styles.muted}>
          {messages.length} recent · {pending} waiting
          {dead > 0 ? ` · ${dead} gave up` : ""}
        </p>
      </div>

      {(emailProvider === "console" || smsProvider === "console") && (
        <p className={styles.notice}>
          {smsProvider === "console" && emailProvider === "console"
            ? "No delivery provider is configured, so messages are written to the server log instead of sent."
            : "SMS has no provider configured, so texts are written to the server log instead of sent."}{" "}
          The queue below is real either way — nothing is lost.
        </p>
      )}

      {messages.length === 0 ? (
        <p className={styles.empty}>Nothing queued yet.</p>
      ) : (
        <ul className={styles.list} role="list">
          {messages.map((m) => {
            let preview = "";
            try {
              preview = renderTemplate(m.template, m.channel, m.payload).body;
            } catch (error) {
              preview =
                "Cannot render: " +
                (error instanceof Error ? error.message : "unknown");
            }

            return (
              <li
                key={m.id}
                className={`${styles.row} ${
                  m.status === "DEAD"
                    ? styles.rowDead
                    : m.status === "FAILED"
                      ? styles.rowFailed
                      : ""
                }`}
              >
                <div className={styles.meta}>
                  <span className={`${styles.status} ${styles["s" + m.status] ?? ""}`}>
                    {m.status}
                  </span>
                  <span className={styles.channel}>{m.channel}</span>
                  <span className={styles.template}>{m.template}</span>
                  <span className={styles.recipient}>{m.recipient}</span>
                  {m.attempts > 0 && (
                    <span className={styles.attempts}>
                      {m.attempts} attempt{m.attempts === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                <p className={styles.preview}>{preview}</p>

                {m.lastError && <p className={styles.error}>{m.lastError}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
