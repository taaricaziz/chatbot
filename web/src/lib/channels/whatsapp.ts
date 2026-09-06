import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Cloud API — the parts that are ours.
 *
 * Pure: signatures, payload shapes, the messaging window. No fetch, no state,
 * no Meta account required to test any of it. That matters because the thing
 * blocking this channel is business verification and template approval —
 * weeks of somebody else's queue — and none of the code below should have to
 * wait for that.
 *
 * The shapes here follow Meta's documented webhook payload. If Meta changes
 * it, `parseInbound` returns nothing rather than throwing, and the webhook
 * still answers 200 — see the note there for why that is deliberate.
 */

/** One inbound message, reduced to what the café actually needs. */
export interface InboundMessage {
  /** Meta's message id. The dedupe key: webhooks are retried. */
  id: string;
  /** The sender's number in international format, no plus. */
  from: string;
  /** Display name, when the sender has one set. */
  profileName?: string;
  text: string;
  /** Seconds since the epoch, as Meta sends it. */
  timestamp: number;
}

/**
 * Verifies `X-Hub-Signature-256` against the RAW request body.
 *
 * This is the whole security boundary for the webhook. Without it anyone who
 * learns the URL can make the café's assistant place orders, so the route
 * must refuse before parsing anything — and must hash the raw bytes, because
 * re-serialising the JSON changes them.
 */
export function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;

  const [algorithm, provided] = header.split("=");
  if (algorithm !== "sha256" || !provided) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");

  // Compared byte-wise in constant time. A plain `===` leaks how much of a
  // forged signature was right, one character at a time.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * The GET handshake Meta performs when the webhook URL is first saved.
 * Returns the challenge to echo, or null to refuse.
 */
export function verificationChallenge(
  params: URLSearchParams,
  verifyToken: string,
): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}

/**
 * Pulls the text messages out of a webhook payload.
 *
 * A payload can carry several entries, each with several changes, each with
 * several messages — and also delivery receipts, read receipts and status
 * updates, which are not messages and must not be answered.
 *
 * Anything that is not plain text (image, audio, location, a button press) is
 * skipped here and handled by the caller, because "I can only read text"
 * needs saying once, politely, rather than being silently ignored.
 */
export function parseInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const root = payload as {
    entry?: {
      changes?: {
        value?: {
          contacts?: { wa_id?: string; profile?: { name?: string } }[];
          messages?: {
            id?: string;
            from?: string;
            type?: string;
            timestamp?: string;
            text?: { body?: string };
          }[];
        };
      }[];
    }[];
  };

  for (const entry of root?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;

      const names = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) {
          names.set(contact.wa_id, contact.profile.name);
        }
      }

      for (const message of value.messages) {
        if (message.type !== "text") continue;
        const text = message.text?.body?.trim();
        if (!message.id || !message.from || !text) continue;

        const name = names.get(message.from);
        out.push({
          id: message.id,
          from: message.from,
          ...(name ? { profileName: name } : {}),
          text,
          timestamp: Number(message.timestamp) || Math.floor(Date.now() / 1000),
        });
      }
    }
  }

  return out;
}

/** Non-text messages, so the customer can be told rather than ignored. */
export function countUnsupported(payload: unknown): number {
  const root = payload as {
    entry?: { changes?: { value?: { messages?: { type?: string }[] } }[] }[];
  };
  let n = 0;
  for (const entry of root?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type && message.type !== "text") n++;
      }
    }
  }
  return n;
}

/**
 * Meta's customer-service window.
 *
 * A business may send free-form messages only within 24 hours of the
 * customer's last message. Outside it, only pre-approved template messages
 * are allowed — so an assistant reply composed after the window has closed
 * cannot be delivered at all, and pretending otherwise means a customer
 * waiting for an answer that will never arrive.
 */
export const WINDOW_HOURS = 24;

export function withinServiceWindow(
  lastInboundAtSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!lastInboundAtSeconds) return false;
  const age = nowSeconds - lastInboundAtSeconds;
  return age >= 0 && age < WINDOW_HOURS * 3600;
}

/**
 * `923001234567` as the site stores it: `+923001234567`.
 *
 * WhatsApp gives numbers without a plus. Matching the app's format means a
 * customer who ordered on the website and then messages is the same person,
 * not a second customer row.
 */
export function toE164(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}
