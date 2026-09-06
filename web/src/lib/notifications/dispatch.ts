import "server-only";
import {
  claimDue,
  markFailed,
  markSent,
  type OutboxMessage,
} from "@/lib/repositories/notifications";
import {
  renderTemplate,
  smsSegments,
  type Channel,
} from "@/lib/services/notifications";

/**
 * The outbox worker and its providers.
 *
 * Providers are behind one interface for the same reason payments are: the
 * decision of WHICH service delivers a message should not be visible to the
 * code that decides a message is warranted.
 *
 * With no credentials configured the console provider runs, which logs the
 * fully-rendered message. That is genuinely useful — you can read exactly
 * what a customer would have received — and it means the whole pipeline is
 * exercisable without signing up to anything.
 */

export interface SendResult {
  provider: string;
  detail?: string;
}

export interface NotificationProvider {
  readonly name: string;
  readonly channels: Channel[];
  send(
    channel: Channel,
    recipient: string,
    subject: string,
    body: string,
  ): Promise<SendResult>;
}

// ------------------------------------------------------------------ console
const consoleProvider: NotificationProvider = {
  name: "console",
  channels: ["EMAIL", "SMS", "WHATSAPP"],
  async send(channel, recipient, subject, body) {
    const segments = channel === "SMS" ? ` (${smsSegments(body)} segment(s))` : "";
    console.info(
      `\n[notify:console] ${channel} -> ${recipient}${segments}\n` +
        `  subject: ${subject}\n` +
        body
          .split("\n")
          .map((l) => `  | ${l}`)
          .join("\n") +
        "\n",
    );
    return { provider: "console", detail: "logged, not delivered" };
  },
};

// ------------------------------------------------------------------- resend
const resendProvider: NotificationProvider = {
  name: "resend",
  channels: ["EMAIL"],
  async send(_channel, recipient, subject, body) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;
    if (!key || !from) throw new Error("RESEND_API_KEY or RESEND_FROM missing.");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [recipient], subject, text: body }),
    });

    if (!res.ok) {
      // Include the status: a 422 (bad address) is a permanent failure worth
      // giving up on, while a 5xx is worth retrying. The retry policy does
      // not distinguish yet, but the operator reading last_error can.
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend responded ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { provider: "resend", detail: data.id };
  },
};

/**
 * Chooses a provider for a channel.
 *
 * Falls back to the console rather than throwing: a café with no email
 * account configured should still be able to take orders, and the message
 * stays visible in the log and in the admin outbox.
 */
export function providerFor(channel: Channel): NotificationProvider {
  if (channel === "EMAIL" && process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    return resendProvider;
  }
  // SMS and WhatsApp are Phase 12+ decisions — CafeBot already has working
  // Twilio/Vonage/Telnyx integrations to adapt, and WhatsApp needs Meta
  // business verification. Until then these log rather than pretending.
  return consoleProvider;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  results: {
    id: string;
    template: string;
    channel: Channel;
    recipient: string;
    outcome: "sent" | "failed";
    provider?: string;
    error?: string;
  }[];
}

/**
 * Drains due messages.
 *
 * Deliberately serial: a café's volume never needs concurrency, and serial
 * sending keeps the log readable and the provider's rate limits comfortable.
 */
export async function drainOutbox(limit = 20): Promise<DrainResult> {
  const due = await claimDue(limit);
  const result: DrainResult = { claimed: due.length, sent: 0, failed: 0, results: [] };

  for (const message of due) {
    try {
      await sendOne(message);
      await markSent(message.id);
      result.sent += 1;
      result.results.push({
        id: message.id,
        template: message.template,
        channel: message.channel,
        recipient: message.recipient,
        outcome: "sent",
        provider: providerFor(message.channel).name,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await markFailed(message.id, text);
      result.failed += 1;
      result.results.push({
        id: message.id,
        template: message.template,
        channel: message.channel,
        recipient: message.recipient,
        outcome: "failed",
        error: text,
      });
    }
  }

  return result;
}

async function sendOne(message: OutboxMessage): Promise<void> {
  // Rendered at SEND time, not enqueue time, so fixing a typo in a template
  // corrects every message still waiting to go out.
  const { subject, body } = renderTemplate(
    message.template,
    message.channel,
    message.payload,
  );
  const provider = providerFor(message.channel);
  await provider.send(message.channel, message.recipient, subject, body);
}
