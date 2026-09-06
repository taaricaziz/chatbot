import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countUnsupported,
  parseInbound,
  toE164,
  verificationChallenge,
  verifySignature,
  withinServiceWindow,
  WINDOW_HOURS,
} from "@/lib/channels/whatsapp";
import {
  claimMessage,
  historyFor,
  remember,
  resetWhatsApp,
} from "@/lib/repositories/whatsapp-conversations";

const SECRET = "test-app-secret";
const sign = (body: string, secret = SECRET) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

beforeEach(() => resetWhatsApp());

describe("signature verification — the whole security boundary", () => {
  const body = '{"entry":[]}';

  it("accepts a correctly signed body", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body that was tampered with after signing", () => {
    const signature = sign(body);
    expect(verifySignature('{"entry":[{"evil":1}]}', signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifySignature(body, sign(body, "not-the-secret"), SECRET)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, "", SECRET)).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    // An unauthenticated webhook that can place orders must fail closed.
    expect(verifySignature(body, sign(body), "")).toBe(false);
  });

  it("rejects an unexpected algorithm", () => {
    const sha1 = "sha1=" + createHmac("sha1", SECRET).update(body).digest("hex");
    expect(verifySignature(body, sha1, SECRET)).toBe(false);
  });

  it("rejects a malformed or truncated signature without throwing", () => {
    for (const bad of ["sha256=", "sha256=zz", "garbage", "sha256=abc123"]) {
      expect(() => verifySignature(body, bad, SECRET)).not.toThrow();
      expect(verifySignature(body, bad, SECRET)).toBe(false);
    }
  });

  it("is sensitive to a single flipped byte", () => {
    const good = sign(body);
    const flipped = good.slice(0, -1) + (good.at(-1) === "a" ? "b" : "a");
    expect(verifySignature(body, flipped, SECRET)).toBe(false);
  });
});

describe("Meta's setup handshake", () => {
  const params = (o: Record<string, string>) => new URLSearchParams(o);

  it("returns the challenge when the token matches", () => {
    const c = verificationChallenge(
      params({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "12345" }),
      "tok",
    );
    expect(c).toBe("12345");
  });

  it("refuses a wrong token", () => {
    expect(
      verificationChallenge(
        params({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" }),
        "tok",
      ),
    ).toBeNull();
  });

  it("refuses when no token is configured", () => {
    expect(
      verificationChallenge(
        params({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }),
        "",
      ),
    ).toBeNull();
  });

  it("refuses a mode other than subscribe", () => {
    expect(
      verificationChallenge(
        params({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }),
        "tok",
      ),
    ).toBeNull();
  });
});

/** A payload shaped like Meta's, trimmed to the fields that are read. */
const payload = (messages: unknown[], contacts: unknown[] = []) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ field: "messages", value: { contacts, messages } }] }],
});

describe("reading a webhook payload", () => {
  it("pulls out a text message with its sender and id", () => {
    const [m] = parseInbound(
      payload(
        [{ id: "wamid.1", from: "923001234567", type: "text", timestamp: "1788600000", text: { body: "  a flat white please  " } }],
        [{ wa_id: "923001234567", profile: { name: "Sana" } }],
      ),
    );
    expect(m!.id).toBe("wamid.1");
    expect(m!.from).toBe("923001234567");
    expect(m!.text).toBe("a flat white please");
    expect(m!.profileName).toBe("Sana");
  });

  it("ignores delivery and read receipts, which are not messages", () => {
    // A status-only payload has no `messages` key at all. Answering one would
    // mean replying to our own delivery receipt.
    const statuses = {
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "read" }] } }] }],
    };
    expect(parseInbound(statuses)).toEqual([]);
  });

  it("skips non-text messages but counts them, so they can be acknowledged", () => {
    const p = payload([
      { id: "wamid.2", from: "923001234567", type: "image", timestamp: "1788600000" },
    ]);
    expect(parseInbound(p)).toEqual([]);
    expect(countUnsupported(p)).toBe(1);
  });

  it("skips a text message with an empty body", () => {
    expect(
      parseInbound(payload([{ id: "wamid.3", from: "92300", type: "text", timestamp: "1", text: { body: "   " } }])),
    ).toEqual([]);
  });

  it("survives a payload shaped differently than expected", () => {
    // Meta changes shapes. Returning nothing beats throwing inside a webhook.
    for (const junk of [null, undefined, {}, { entry: null }, { entry: [{}] }, "nope", 42]) {
      expect(() => parseInbound(junk)).not.toThrow();
      expect(parseInbound(junk)).toEqual([]);
    }
  });

  it("reads several messages from one delivery", () => {
    const p = payload([
      { id: "a", from: "1", type: "text", timestamp: "1", text: { body: "one" } },
      { id: "b", from: "2", type: "text", timestamp: "2", text: { body: "two" } },
    ]);
    expect(parseInbound(p).map((m) => m.text)).toEqual(["one", "two"]);
  });
});

describe("dedupe — a retry must not become a second order", () => {
  it("claims an id once and refuses it after", () => {
    expect(claimMessage("wamid.1")).toBe(true);
    expect(claimMessage("wamid.1")).toBe(false);
    expect(claimMessage("wamid.1")).toBe(false);
  });

  it("keeps different messages independent", () => {
    expect(claimMessage("a")).toBe(true);
    expect(claimMessage("b")).toBe(true);
  });
});

describe("the 24-hour service window", () => {
  const now = 1_788_600_000;

  it("is open immediately after the customer writes", () => {
    expect(withinServiceWindow(now, now)).toBe(true);
  });

  it("is open just inside the limit", () => {
    expect(withinServiceWindow(now - (WINDOW_HOURS * 3600 - 60), now)).toBe(true);
  });

  it("is closed just outside it", () => {
    expect(withinServiceWindow(now - WINDOW_HOURS * 3600, now)).toBe(false);
  });

  it("is closed when there is no inbound message at all", () => {
    expect(withinServiceWindow(0, now)).toBe(false);
  });
});

describe("conversation memory", () => {
  const now = 1_788_600_000;

  it("starts empty and remembers a turn", () => {
    expect(historyFor("923001234567", now)).toEqual([]);
    remember("923001234567", "hello", "hi there", now);
    expect(historyFor("923001234567", now)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  it("forgets once the window has closed — a new conversation, not a continued one", () => {
    remember("923001234567", "hello", "hi", now);
    const later = now + WINDOW_HOURS * 3600 + 1;
    expect(historyFor("923001234567", later)).toEqual([]);
  });

  it("keeps numbers separate", () => {
    remember("111", "a", "b", now);
    remember("222", "c", "d", now);
    expect(historyFor("111", now)).toHaveLength(2);
    expect(historyFor("222", now)[0]!.content).toBe("c");
  });

  it("bounds a long conversation instead of growing forever", () => {
    // Unbounded history would eventually exceed the free tier's per-minute
    // token budget, which is the limit that actually binds.
    for (let i = 0; i < 40; i++) remember("111", `q${i}`, `a${i}`, now);
    const turns = historyFor("111", now);
    expect(turns.length).toBeLessThanOrEqual(20);
    // The most recent exchange survives, which is the part that matters.
    expect(turns.at(-1)!.content).toBe("a39");
  });
});

describe("phone numbers", () => {
  it("matches the format the rest of the app stores", () => {
    // So a customer who ordered on the website and then messages is the same
    // person, not a second customer row.
    expect(toE164("923001234567")).toBe("+923001234567");
  });

  it("tolerates punctuation and an existing plus", () => {
    expect(toE164("+92 300 123 4567")).toBe("+923001234567");
  });

  it("returns empty for nothing usable", () => {
    expect(toE164("")).toBe("");
    expect(toE164("abc")).toBe("");
  });
});
