import "server-only";

/**
 * Sending a WhatsApp message.
 *
 * Behind an interface with a console fallback, for the same reason the
 * notification providers are: with no credentials configured the message is
 * written to the log exactly as it would have been sent, so the whole
 * inbound-to-reply path is exercisable without a Meta account.
 *
 * That matters more here than anywhere else in the build, because the thing
 * standing between this code and production is not code — it is Meta
 * business verification and template approval, which is weeks of somebody
 * else's queue.
 */

export interface SendResult {
  provider: "cloud-api" | "console";
  ok: boolean;
  detail?: string;
}

interface Config {
  token: string;
  phoneNumberId: string;
}

function configured(): Config | null {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId };
}

export function whatsAppConfigured(): boolean {
  return configured() !== null;
}

/**
 * Sends a free-form text reply.
 *
 * Only valid inside Meta's 24-hour customer-service window; outside it the
 * API rejects anything that is not an approved template. The caller checks
 * the window — this reports the refusal rather than pretending it sent.
 */
export async function sendWhatsAppText(
  to: string,
  body: string,
): Promise<SendResult> {
  const config = configured();

  if (!config) {
    // Not an error. This is the expected state until Meta approves the
    // number, and the log line is genuinely useful: it is exactly what the
    // customer would have received.
    console.info(`[whatsapp→${to}] ${body}`);
    return { provider: "console", ok: true };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          // Link previews off: a menu reply should not sprout a card for
          // whatever URL happens to appear in it.
          text: { preview_url: false, body },
        }),
      },
    );

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      console.error(`[whatsapp] send failed ${response.status}: ${detail}`);
      return { provider: "cloud-api", ok: false, detail };
    }
    return { provider: "cloud-api", ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error("[whatsapp] send threw:", detail);
    return { provider: "cloud-api", ok: false, detail };
  }
}
