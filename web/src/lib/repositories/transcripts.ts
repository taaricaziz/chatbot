import "server-only";
import type { ToolTrace } from "@/agent/runtime";

/**
 * What the assistant actually said to people.
 *
 * There was no record of this before Phase 14, which is the single biggest
 * gap in putting it in front of customers: ten real transcripts will teach
 * more than twenty more synthetic tests. Append-only, same shape as the audit
 * trail — nothing here offers an update.
 *
 * PRIVACY: conversations are stored to be read by staff, so they hold whatever
 * a customer typed, which can include a name, a phone number and an address.
 * They are bounded to the most recent 200 and never leave the server. Nothing
 * here is sent anywhere; the admin view is behind the staff session and
 * X-Robots-Tag: noindex.
 */

export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface Transcript {
  id: string;
  startedAt: string;
  lastAt: string;
  turns: TranscriptTurn[];
  toolTrace: ToolTrace[];
  costMicroUsd: number;
  /** Set when the assistant called request_human, so escalations sort to the top. */
  escalated: boolean;
  escalationReason?: string;
  /** Order numbers this conversation actually created. */
  orderNumbers: string[];
}

const g = globalThis as unknown as { gooteeTranscripts?: Map<string, Transcript> };
const store = (g.gooteeTranscripts ??= new Map<string, Transcript>());

const MAX_TRANSCRIPTS = 200;

export function appendTranscript(input: {
  id: string;
  userMessage: string;
  assistantReply: string;
  toolTrace: ToolTrace[];
  costMicroUsd: number;
}): void {
  const now = new Date().toISOString();
  const existing = store.get(input.id);

  const transcript: Transcript = existing ?? {
    id: input.id,
    startedAt: now,
    lastAt: now,
    turns: [],
    toolTrace: [],
    costMicroUsd: 0,
    escalated: false,
    orderNumbers: [],
  };

  transcript.lastAt = now;
  transcript.turns.push({ role: "user", content: input.userMessage, at: now });
  transcript.turns.push({ role: "assistant", content: input.assistantReply, at: now });
  transcript.toolTrace.push(...input.toolTrace);
  transcript.costMicroUsd += input.costMicroUsd;

  const escalation = input.toolTrace.find((t) => t.name === "request_human");
  if (escalation) {
    transcript.escalated = true;
    const reason = escalation.input?.reason;
    if (typeof reason === "string") transcript.escalationReason = reason;
  }

  for (const trace of input.toolTrace) {
    if (trace.name === "place_order" && trace.ok && trace.orderNumber) {
      transcript.orderNumbers.push(trace.orderNumber);
    }
  }

  store.set(input.id, transcript);

  if (store.size > MAX_TRANSCRIPTS) {
    const excess = store.size - MAX_TRANSCRIPTS;
    for (const key of [...store.keys()].slice(0, excess)) store.delete(key);
  }
}

/** Newest first, escalations first within that — they are what needs reading. */
export function listTranscripts(limit = 50): Transcript[] {
  return [...store.values()]
    .sort((a, b) => {
      if (a.escalated !== b.escalated) return a.escalated ? -1 : 1;
      return b.lastAt.localeCompare(a.lastAt);
    })
    .slice(0, limit);
}

export function getTranscript(id: string): Transcript | undefined {
  return store.get(id);
}

export function resetTranscripts(): void {
  store.clear();
}
