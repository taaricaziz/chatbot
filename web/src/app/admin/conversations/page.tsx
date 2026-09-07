import { requireStaff } from "@/lib/auth";
import { listTranscripts } from "@/lib/repositories/transcripts";
import { spendSummary } from "@/lib/repositories/spend-ledger";
import { readSwitch } from "@/lib/repositories/agent-switch";
import { describeBrain, rolloutPercent } from "@/lib/agent-config";
import { toggleAssistant } from "./actions";
import { DEFAULT_BUDGET, formatUsd } from "@/lib/services/spend";
import styles from "./conversations.module.css";

export const dynamic = "force-dynamic";

/**
 * What the assistant actually said to people.
 *
 * Before this page there was no way to know. Ten real conversations will
 * teach more about the assistant than twenty more synthetic tests, and
 * escalations sort to the top because they are the ones somebody is waiting
 * on.
 */
export default async function ConversationsPage() {
  await requireStaff("MANAGER");

  const transcripts = listTranscripts(50);
  const spend = spendSummary();
  // Whichever brain is answering: the local agent's provider, or CafeBot.
  const provider = describeBrain();

  const escalated = transcripts.filter((t) => t.escalated);
  const killSwitch = readSwitch();
  const rollout = rolloutPercent();
  const dailyCap = Number(process.env.AGENT_DAILY_CALLS) || DEFAULT_BUDGET.dailyCalls;

  return (
    <>
      <div className={styles.head}>
        <h1 className={`display ${styles.title}`}>Conversations</h1>
        <p className={styles.muted}>
          {transcripts.length} recent
          {escalated.length > 0 ? ` · ${escalated.length} waiting on a person` : ""}
        </p>
      </div>

      <form action={toggleAssistant} className={styles.switchRow}>
        <input type="hidden" name="off" value={killSwitch.off ? "false" : "true"} />
        <div>
          <p className={styles.switchState}>
            {killSwitch.off ? "The assistant is OFF" : "The assistant is on"}
            {rollout < 100 && !killSwitch.off && (
              <span className={styles.rollout}> · shown to {rollout}% of visitors</span>
            )}
          </p>
          <p className={styles.switchHint}>
            {killSwitch.off
              ? "Nobody is being offered it. Turning it back on takes effect immediately."
              : "Turning it off takes effect on the next page load — no deploy needed."}
            {killSwitch.at && ` Last changed by ${killSwitch.by}.`}
          </p>
        </div>
        <button
          type="submit"
          className={killSwitch.off ? styles.switchOn : styles.switchOff}
        >
          {killSwitch.off ? "Turn on" : "Turn off"}
        </button>
      </form>

      <div className={styles.meter}>
        <div>
          <span className={styles.meterLabel}>Model</span>
          <strong>
            {provider ? `${provider.id} · ${provider.model}` : "not configured"}
          </strong>
          {provider?.free && <span className={styles.free}>free tier</span>}
        </div>
        <div>
          <span className={styles.meterLabel}>Calls today</span>
          <strong>
            {spend.today.calls} <span className={styles.of}>of {dailyCap}</span>
          </strong>
        </div>
        <div>
          <span className={styles.meterLabel}>This month</span>
          <strong>
            {spend.month.calls} calls
            {/* Shown only when it means something. On a free tier the honest
                figure is nothing, and a fake $0.00 invites false confidence. */}
            {spend.month.microUsd > 0 && (
              <span className={styles.of}> · {formatUsd(spend.month.microUsd)}</span>
            )}
          </strong>
        </div>
      </div>

      {transcripts.length === 0 ? (
        <p className={styles.empty}>
          Nobody has talked to the assistant yet. Conversations appear here as
          they happen — they are kept in memory, so a restart clears them.
        </p>
      ) : (
        <ul className={styles.list} role="list">
          {transcripts.map((t) => (
            <li
              key={t.id}
              className={`${styles.row} ${t.escalated ? styles.rowEscalated : ""}`}
            >
              <div className={styles.rowHead}>
                <span className={styles.when}>
                  {new Date(t.lastAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className={styles.tags}>
                  {t.escalated && <span className={styles.escalation}>needs a person</span>}
                  {t.orderNumbers.map((number) => (
                    <span key={number} className={styles.order}>
                      {number}
                    </span>
                  ))}
                  <span className={styles.turns}>
                    {t.turns.length / 2}{" "}
                    {t.turns.length === 2 ? "turn" : "turns"}
                  </span>
                </span>
              </div>

              {t.escalationReason && (
                <p className={styles.reason}>{t.escalationReason}</p>
              )}

              <ol className={styles.log} role="list">
                {t.turns.map((turn, i) => (
                  <li
                    key={i}
                    className={
                      turn.role === "user" ? styles.fromUser : styles.fromBot
                    }
                  >
                    {turn.content}
                  </li>
                ))}
              </ol>

              {t.toolTrace.length > 0 && (
                <p className={styles.tools}>
                  {t.toolTrace.map((call, i) => (
                    <span
                      key={i}
                      className={call.ok ? styles.toolOk : styles.toolFail}
                    >
                      {call.name}
                      {call.error ? ` (${call.error})` : ""}
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
