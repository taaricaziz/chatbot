import "server-only";

/**
 * The staff kill switch.
 *
 * `AGENT_ENABLED` is an environment variable, which on Vercel means a
 * redeploy — and a kill switch that takes a redeploy is not a kill switch.
 * This one takes effect on the next request.
 *
 * In memory, so it resets to "on" when the server restarts. That is the
 * honest default for a demonstration build: a restart should not leave the
 * assistant silently switched off with nobody remembering why. Moving it to
 * Postgres is one row.
 */

interface SwitchState {
  off: boolean;
  by?: string;
  at?: string;
}

const g = globalThis as unknown as { gooteeAgentSwitch?: SwitchState };
const state = (g.gooteeAgentSwitch ??= { off: false });

export function isSwitchedOff(): boolean {
  return state.off;
}

export function readSwitch(): Readonly<SwitchState> {
  return state;
}

export function setSwitch(off: boolean, by: string): void {
  state.off = off;
  state.by = by;
  state.at = new Date().toISOString();
}
