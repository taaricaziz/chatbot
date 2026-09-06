import { resolveProvider } from "@/agent/provider";
import { isSwitchedOff } from "@/lib/repositories/agent-switch";

/**
 * The soft-launch gate.
 *
 * Three separate ways to say no, deliberately, because they answer different
 * questions:
 *
 *  - `AGENT_ENABLED=false` — the operator's decision, survives a restart.
 *  - the staff switch      — stop it NOW, no redeploy, from the console.
 *  - no provider resolves  — nothing to talk to.
 *
 * Off is the safe default only when "off" is explicit: a site that silently
 * stops answering because a variable was misspelt is worse than one that
 * never started. So the assistant is ON when a provider is configured and
 * nobody has said otherwise.
 *
 * Not "use server", not a component. Imported by route handlers and by a
 * Server Component, which is exactly why it is neither.
 */
export function agentEnabled(): boolean {
  const flag = process.env.AGENT_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  if (isSwitchedOff()) return false;
  return resolveProvider() !== null;
}

/**
 * What fraction of visitors are OFFERED the assistant. Default 100.
 *
 * Separate from `agentEnabled` because it answers a different question:
 * enabled is whether the thing works, rollout is how many people meet it
 * while we are still reading every transcript.
 */
export function rolloutPercent(): number {
  const raw = Number(process.env.AGENT_ROLLOUT_PERCENT);
  if (!Number.isFinite(raw)) return 100;
  return Math.max(0, Math.min(100, Math.floor(raw)));
}
