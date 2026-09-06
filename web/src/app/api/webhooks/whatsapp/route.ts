import { after } from "next/server";
import { runAgent, AgentUnavailableError } from "@/agent/runtime";
import {
  countUnsupported,
  parseInbound,
  verificationChallenge,
  verifySignature,
  withinServiceWindow,
} from "@/lib/channels/whatsapp";
import { sendWhatsAppText } from "@/lib/channels/whatsapp-send";
import {
  claimMessage,
  historyFor,
  remember,
} from "@/lib/repositories/whatsapp-conversations";
import { appendTranscript } from "@/lib/repositories/transcripts";
import { agentEnabled } from "@/lib/agent-config";

/**
 * The WhatsApp Cloud API webhook.
 *
 * Meta retries any delivery it does not consider acknowledged quickly, and a
 * tool-using agent turn takes several seconds — so this ACKNOWLEDGES FIRST
 * and does the work in `after()`, which Vercel keeps alive past the
 * response. Answering only when the reply is ready would earn duplicate
 * deliveries, and duplicate deliveries of an ordering assistant are
 * duplicate orders.
 *
 * Dedupe by message id is the second half of that guarantee, because a retry
 * can still arrive before the first run finishes.
 */
export const dynamic = "force-dynamic";

/** Meta's handshake when the webhook URL is first saved. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = verificationChallenge(
    url.searchParams,
    process.env.WHATSAPP_VERIFY_TOKEN ?? "",
  );

  if (challenge === null) {
    return new Response("Forbidden", { status: 403 });
  }
  // Echoed as plain text, which is what Meta expects.
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";

  // Read the RAW body: the signature is over these exact bytes, and
  // re-serialising parsed JSON would change them.
  const raw = await request.text();

  // The whole security boundary. Without a configured secret the endpoint
  // refuses outright rather than accepting unsigned requests — an
  // unauthenticated webhook that can place orders is not a soft failure.
  if (
    !appSecret ||
    !verifySignature(raw, request.headers.get("x-hub-signature-256"), appSecret)
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Acknowledged: a malformed body is not something Meta should retry.
    return new Response("ok", { status: 200 });
  }

  const messages = parseInbound(payload);
  const unsupported = countUnsupported(payload);

  // Claimed synchronously, BEFORE acknowledging, so a retry arriving while
  // the first run is still working is refused rather than duplicated.
  const fresh = messages.filter((m) => claimMessage(m.id));

  if (fresh.length > 0 || unsupported > 0) {
    after(async () => {
      for (const message of fresh) {
        try {
          if (!agentEnabled()) {
            await sendWhatsAppText(
              message.from,
              "Thanks for messaging. Someone from the café will reply shortly.",
            );
            continue;
          }

          // Meta's window is measured from the customer's message, which is
          // the one we are answering — so this is all but always open. It is
          // checked anyway because a slow queue is exactly when it would not
          // be, and a reply sent outside it is silently dropped by Meta.
          if (!withinServiceWindow(message.timestamp)) {
            console.warn(
              `[whatsapp] window closed for ${message.from}; free-form reply not sent`,
            );
            continue;
          }

          const history = historyFor(message.from);
          const result = await runAgent(history, message.text, {
            // The phone number groups the conversation for the quota and
            // the transcript, exactly as the widget's random id does.
            conversationId: `wa:${message.from}`,
          });

          remember(message.from, message.text, result.reply);

          appendTranscript({
            id: `wa:${message.from}`,
            userMessage: message.text,
            assistantReply: result.reply,
            toolTrace: result.toolTrace,
            costMicroUsd: result.costMicroUsd,
          });

          await sendWhatsAppText(message.from, result.reply);
        } catch (error) {
          const busy =
            error instanceof AgentUnavailableError && error.retryable;
          console.error(
            "[whatsapp] handling failed:",
            error instanceof Error ? error.message : error,
          );
          // The customer is owed an answer either way; silence reads as the
          // café ignoring them.
          await sendWhatsAppText(
            message.from,
            busy
              ? "Lots of people are messaging at once — give me a minute and send that again."
              : "Sorry, something went wrong at our end. Please try again, or call the café.",
          );
        }
      }

      // Said once per delivery rather than once per attachment, so sending
      // three photos does not earn three identical replies.
      if (unsupported > 0 && messages.length === 0) {
        const to = firstSender(payload);
        if (to) {
          await sendWhatsAppText(
            to,
            "I can only read text messages at the moment. Could you type it instead?",
          );
        }
      }
    });
  }

  return new Response("ok", { status: 200 });
}

/** Who sent a payload that carried no text message. */
function firstSender(payload: unknown): string | null {
  const root = payload as {
    entry?: { changes?: { value?: { messages?: { from?: string }[] } }[] }[];
  };
  for (const entry of root?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.from) return message.from;
      }
    }
  }
  return null;
}
