import { resolveProvider } from "@/agent/provider";
import { isSwitchedOff } from "@/lib/repositories/agent-switch";
import { cafeBotConfigured, cafeBotUrl } from "@/lib/channels/cafebot";

/**
 * Which brain answers, and whether it is switched on.
 *
 * Two brains, one widget:
 *   - "local"   — the agent in src/agent/, on whichever model provider is
 *                 configured (free ones first).
 *   - "cafebot" — the original CafeBot in backend/, deployed separately and
 *                 asked over HTTP. Its own tools, its own prompt, its own
 *                 order store.
 *
 * Selected by AGENT_BRAIN. "cafebot" without CAFEBOT_URL falls back to
 * "local" with a warning rather than silently answering nothing.
 *
 * Not "use server", not a component. Imported by route handlers and by a
 * Server Component, which is exactly why it is neither.
 */
export type Brain = "local" | "cafebot";

let warnedMissingUrl = false;

export function agentBrain(): Brain {
  const requested = process.env.AGENT_BRAIN?.trim().toLowerCase();
  if (requested !== "cafebot") return "local";

  if (!cafeBotConfigured()) {
    if (!warnedMissingUrl) {
      warnedMissingUrl = true;
      console.warn(
        "[agent] AGENT_BRAIN=cafebot but CAFEBOT_URL is not set — using the local agent.",
      );
    }
    return "local";
  }
  return "cafebot";
}

/** For the staff console: what is answering, in one line. */
export function describeBrain(): { id: string; model: string; free: boolean } | null {
  if (agentBrain() === "cafebot") {
    const host = new URL(cafeBotUrl()!).host;
    // CafeBot runs on Anthropic (backend/server.js: AI_API_KEY). Not free.
    return { id: "cafebot", model: host, free: false };
  }
  return resolveProvider();
}

/**
 * The soft-launch gate.
 *
 * Three separate ways to say no, deliberately, because they answer different
 * questions:
 *
 *  - `AGENT_ENABLED=false` — the operator's decision, survives a restart.
 *  - the staff switch      — stop it NOW, no redeploy, from the console.
 *  - nothing to talk to    — no provider resolves, or CafeBot is not reachable
 *                            by configuration.
 *
 * Off is the safe default only when "off" is explicit: a site that silently
 * stops answering because a variable was misspelt is worse than one that
 * never started.
 */
export function agentEnabled(): boolean {
  const flag = process.env.AGENT_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  if (isSwitchedOff()) return false;
  if (agentBrain() === "cafebot") return true;
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
