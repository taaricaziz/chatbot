import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { askCafeBot, CafeBotError } from "@/lib/channels/cafebot";

/**
 * askCafeBot against a real HTTP server speaking CafeBot's contract.
 *
 * The server is a double of backend/server.js's /api/chat, not a stub of our
 * own client — so the request we send, the response shapes we accept and
 * the error mapping are all exercised over the wire.
 */

type Scripted =
  | { status: number; json: unknown }
  | { status: number; raw: string };

let server: Server;
let baseUrl: string;
let next: Scripted = { status: 200, json: {} };
let received: { body: Record<string, unknown>; path: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body: body ? JSON.parse(body) : {}, path: req.url ?? "" });
      if ("raw" in next) {
        res.writeHead(next.status, { "Content-Type": "text/plain" });
        res.end(next.raw);
      } else {
        res.writeHead(next.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(next.json));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  received = [];
});

const ask = (message = "hello", sessionId = "conv-123") =>
  askCafeBot({
    message,
    history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    sessionId,
    baseUrl,
  });

describe("the request CafeBot receives", () => {
  it("posts to /api/chat with message, history and the session id", async () => {
    next = { status: 200, json: { reply: "ok", sessionId: "conv-123", order: null } };
    await ask("what coffee do you have?");

    expect(received[0]!.path).toBe("/api/chat");
    expect(received[0]!.body).toEqual({
      message: "what coffee do you have?",
      history: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      // The widget's conversation id IS CafeBot's session key, so one value
      // groups the quota, the transcript and CafeBot's cart.
      sessionId: "conv-123",
    });
  });
});

describe("the reply", () => {
  it("strips CafeBot's markdown — the widget renders plain text", async () => {
    next = {
      status: 200,
      json: { reply: "Here you go:\n\n- **Flat White** — Rs. 620", sessionId: "s", order: null },
    };
    const answer = await ask();
    expect(answer.reply).toBe("Here you go:\n\n- Flat White — Rs. 620");
    expect(answer.reply).not.toContain("**");
  });

  it("passes CafeBot's session id back", async () => {
    next = { status: 200, json: { reply: "ok", sessionId: "cafebot-generated", order: null } };
    expect((await ask()).sessionId).toBe("cafebot-generated");
  });

  it("keeps our session id when CafeBot omits one", async () => {
    next = { status: 200, json: { reply: "ok" } };
    expect((await ask("x", "ours")).sessionId).toBe("ours");
  });

  it("surfaces a confirmed order's id so the console can show it", async () => {
    next = {
      status: 200,
      json: { reply: "Placed!", sessionId: "s", order: { status: "confirmed", orderId: "CB-3F9A1C" } },
    };
    const answer = await ask();
    expect(answer.orderId).toBe("CB-3F9A1C");
    expect(answer.orderStatus).toBe("confirmed");
  });

  it("reports no order id while the cart is still a draft", async () => {
    next = {
      status: 200,
      json: { reply: "Added.", sessionId: "s", order: { status: "draft", orderId: null } },
    };
    const answer = await ask();
    expect(answer.orderId).toBeUndefined();
    expect(answer.orderStatus).toBe("draft");
  });
});

describe("when CafeBot fails", () => {
  const failure = async () => {
    try {
      await ask();
    } catch (e) {
      return e as CafeBotError;
    }
    throw new Error("expected askCafeBot to throw");
  };

  it("treats its 502 (its own model call failed) as worth retrying", async () => {
    next = { status: 502, json: { error: "Failed to get a response from the AI service." } };
    const e = await failure();
    expect(e).toBeInstanceOf(CafeBotError);
    expect(e.retryable).toBe(true);
  });

  it("treats a 400 (we sent something wrong) as NOT worth retrying", async () => {
    next = { status: 400, json: { error: "message is required" } };
    expect((await failure()).retryable).toBe(false);
  });

  it("rejects a 200 with no reply in it, rather than showing an empty bubble", async () => {
    next = { status: 200, json: { sessionId: "s" } };
    const e = await failure();
    expect(e.retryable).toBe(false);
    expect(e.message).toMatch(/no reply/i);
  });

  it("rejects a 200 that is not JSON at all", async () => {
    next = { status: 200, raw: "<html>maintenance</html>" };
    expect((await failure()).retryable).toBe(false);
  });

  it("treats an unreachable host as worth retrying", async () => {
    const e = await askCafeBot({
      message: "x",
      history: [],
      sessionId: "s",
      // Port 9 is the discard service; nothing listens there.
      baseUrl: "http://127.0.0.1:9",
    }).catch((err) => err as CafeBotError);
    expect(e).toBeInstanceOf(CafeBotError);
    expect((e as CafeBotError).retryable).toBe(true);
  });

  it("refuses outright when no URL is configured", async () => {
    const saved = process.env.CAFEBOT_URL;
    delete process.env.CAFEBOT_URL;
    try {
      const e = await askCafeBot({ message: "x", history: [], sessionId: "s" }).catch(
        (err) => err as CafeBotError,
      );
      expect((e as CafeBotError).retryable).toBe(false);
    } finally {
      if (saved !== undefined) process.env.CAFEBOT_URL = saved;
    }
  });
});
