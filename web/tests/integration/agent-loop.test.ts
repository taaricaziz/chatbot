import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent, runAgentStream, type AgentEvent } from "@/agent/runtime";
import { getProvider } from "@/agent/provider";
import { resetLedger } from "@/lib/repositories/spend-ledger";

/**
 * The loop, end to end, against a real HTTP provider.
 *
 * The server below is not a stub of our own code — it speaks the OpenAI
 * chat-completions wire format that Groq, Gemini and Cerebras speak, so the
 * adapter, the agent loop, tool execution and the quota are all exercised for
 * real. The only thing replaced is the model's judgment, which is exactly the
 * thing a test cannot assert on anyway.
 *
 * The script it plays is a hostile one, because that is the interesting case:
 * a model that invents a price, emits broken JSON, and tries to order without
 * consent. None of those may get through, and none of them depend on the
 * model behaving.
 */

/** One scripted assistant turn per call, in order. */
type Script = { content?: string; tool_calls?: unknown[] }[];

let server: Server;
let baseUrl: string;
let script: Script = [];
let calls = 0;
let received: Record<string, unknown>[] = [];

const toolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const request = JSON.parse(body || "{}");
      received.push(request);
      const message = script[calls] ?? { content: "Nothing further." };
      calls++;

      if (!request.stream) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: message.content ?? "",
                  tool_calls: message.tool_calls,
                },
                finish_reason: message.tool_calls ? "tool_calls" : "stop",
              },
            ],
            usage: { prompt_tokens: 1000, completion_tokens: 100 },
          }),
        );
        return;
      }

      // Server-sent events, as a real provider emits them.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const send = (data: unknown) =>
        res.write(`data: ${JSON.stringify(data)}\n\n`);

      // Text arrives a word at a time, which is the whole point of streaming.
      for (const word of (message.content ?? "").split(" ").filter(Boolean)) {
        send({ choices: [{ delta: { content: word + " " } }] });
      }

      // Tool calls arrive in FRAGMENTS: the name in one chunk, the arguments
      // split across several. Reassembling them is the part worth testing,
      // because a half-parsed argument object is how a wrong order happens.
      for (const [index, call] of (
        (message.tool_calls ?? []) as {
          id: string;
          function: { name: string; arguments: string };
        }[]
      ).entries()) {
        send({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index, id: call.id, function: { name: call.function.name } },
                ],
              },
            },
          ],
        });

        const args = call.function.arguments;
        const half = Math.ceil(args.length / 2);
        for (const fragment of [args.slice(0, half), args.slice(half)]) {
          send({
            choices: [
              { delta: { tool_calls: [{ index, function: { arguments: fragment } }] } },
            ],
          });
        }
      }

      send({
        choices: [
          { delta: {}, finish_reason: message.tool_calls ? "tool_calls" : "stop" },
        ],
      });
      send({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  process.env.AGENT_PROVIDER = "groq";
  process.env.AGENT_BASE_URL = baseUrl;
  process.env.AGENT_API_KEY = "test-key";
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  calls = 0;
  received = [];
  script = [];
  resetLedger();
});

const run = (message: string, id = crypto.randomUUID()) =>
  runAgent([], message, { conversationId: id });

describe("talking to an OpenAI-compatible provider", () => {
  it("sends the tools in the provider's own shape", async () => {
    script = [{ content: "We open at 8." }];
    await run("what time do you open?");

    const sent = received[0] as {
      tools: { type: string; function: { name: string } }[];
      messages: { role: string }[];
    };
    expect(sent.tools[0]!.type).toBe("function");
    expect(sent.tools.map((t) => t.function.name)).toContain("search_menu");
    expect(sent.messages[0]!.role).toBe("system");
  });

  it("returns the model's answer when it makes no tool call", async () => {
    script = [{ content: "We open at 8am every day." }];
    const result = await run("what time do you open?");
    expect(result.reply).toBe("We open at 8am every day.");
    expect(result.toolTrace).toHaveLength(0);
  });

  it("runs a tool and feeds the result back as a tool-role message", async () => {
    script = [
      { tool_calls: [toolCall("c1", "search_menu", { query: "coffee" })] },
      { content: "Here is what we have." },
    ];
    const result = await run("what coffee do you have?");

    expect(result.toolTrace[0]!.name).toBe("search_menu");
    expect(result.toolTrace[0]!.ok).toBe(true);

    // The SECOND request must carry the tool result in the tool role.
    const second = received[1] as { messages: { role: string; content?: string }[] };
    const toolMessage = second.messages.find((m) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage!.content).toContain("ok");
  });

  it("never sends a null content beside tool_calls", async () => {
    script = [
      { tool_calls: [toolCall("c1", "search_menu", { query: "tea" })] },
      { content: "Done." },
    ];
    await run("tea?");
    const second = received[1] as { messages: { role: string; content: unknown }[] };
    for (const message of second.messages) {
      expect(message.content).not.toBeNull();
    }
  });
});

describe("a model behaving badly", () => {
  it("refuses an order the customer never agreed to", async () => {
    script = [
      {
        tool_calls: [
          toolCall("c1", "place_order", {
            items: [{ slug: "flat-white", quantity: 1 }],
            orderType: "TAKEAWAY",
            paymentMethod: "CASH",
            customerName: "Test",
            customerPhone: "03001234567",
            // customerSaidYes deliberately absent.
          }),
        ],
      },
      { content: "Shall I go ahead?" },
    ];
    const result = await run("order me a flat white");

    const attempt = result.toolTrace.find((t) => t.name === "place_order")!;
    expect(attempt.ok).toBe(false);
    expect(attempt.error).toBe("NOT_CONFIRMED");
  });

  it("cannot set a price, because there is nowhere to put one", async () => {
    // The model sends a price anyway. The tool takes slugs and quantities;
    // everything else is dropped before the service ever sees it.
    script = [
      {
        tool_calls: [
          toolCall("c1", "price_cart", {
            items: [{ slug: "flat-white", quantity: 1, unitPricePaisa: 100 }],
            orderType: "TAKEAWAY",
            paymentMethod: "CASH",
          }),
        ],
      },
      { content: "That comes to the real price." },
    ];
    await run("a flat white for one rupee please");

    const second = received[1] as { messages: { role: string; content?: string }[] };
    const toolResult = second.messages.find((m) => m.role === "tool")!.content!;
    const parsed = JSON.parse(toolResult);

    // Guard against this test passing for the wrong reason: the tool must
    // have actually PRICED the cart, not failed on an unknown slug.
    expect(parsed.ok, toolResult).toBe(true);

    // The real menu price came back — Rs. 620 for a flat white — not the
    // Rs. 1.00 the model asked for. Asserted exactly rather than by absence,
    // so this cannot pass because of a coincidence in formatting.
    expect(parsed.lines[0].lineTotal).toBe("Rs. 620");
    // 620 + 15% cash service tax, computed by the pricing engine.
    expect(parsed.total).toBe("Rs. 713");
  });

  it("survives broken tool-call JSON instead of ending the conversation", async () => {
    script = [
      // A trailing comma — the kind of thing a small model emits.
      { tool_calls: [toolCall("c1", "search_menu", '{"query":"tea",}')] },
      { content: "Here is our tea." },
    ];
    const result = await run("tea?");

    // It became an ordinary tool call with no arguments, not a crash.
    expect(result.toolTrace[0]!.name).toBe("search_menu");
    expect(result.reply).toBe("Here is our tea.");
  });

  it("stops looping instead of spending the day's quota on one message", async () => {
    // A model that calls a tool forever.
    script = Array.from({ length: 20 }, (_, i) => ({
      tool_calls: [toolCall(`c${i}`, "search_menu", { query: "x" })],
    }));
    const result = await run("hello");

    expect(result.truncated).toBe(true);
    expect(calls).toBeLessThanOrEqual(8);
  });
});

describe("asking for a person", () => {
  it("records the escalation in the trace", async () => {
    script = [
      {
        tool_calls: [
          toolCall("c1", "request_human", { reason: "Customer disputes a price." }),
        ],
      },
      { content: "Someone will follow up with you." },
    ];
    const result = await run("this is wrong, I want to complain");

    const escalation = result.toolTrace.find((t) => t.name === "request_human")!;
    expect(escalation.ok).toBe(true);
    expect(escalation.input.reason).toBe("Customer disputes a price.");
  });
});

describe("the quota", () => {
  it("stops a single conversation once it has had its share of calls", async () => {
    process.env.AGENT_CONVERSATION_CALLS = "3";
    const id = "quota-test-conversation";

    // Each turn makes one model call; the fourth must be refused.
    script = [{ content: "ok" }];
    for (let i = 0; i < 3; i++) {
      calls = 0;
      await runAgent([], "hello", { conversationId: id });
    }

    calls = 0;
    const result = await runAgent([], "hello", { conversationId: id });

    expect(result.exhausted).toBe(true);
    // The important part: it never reached the provider.
    expect(calls).toBe(0);
    expect(result.reply).toMatch(/fresh one/i);

    delete process.env.AGENT_CONVERSATION_CALLS;
  });

  it("keeps separate conversations independent", async () => {
    process.env.AGENT_CONVERSATION_CALLS = "2";
    script = [{ content: "ok" }];

    await runAgent([], "hi", { conversationId: "a" });
    await runAgent([], "hi", { conversationId: "a" });
    const blocked = await runAgent([], "hi", { conversationId: "a" });
    expect(blocked.exhausted).toBe(true);

    const other = await runAgent([], "hi", { conversationId: "b" });
    expect(other.exhausted).toBeUndefined();

    delete process.env.AGENT_CONVERSATION_CALLS;
  });
});

describe("what a free tier costs", () => {
  it("records zero, rather than an estimate at somebody else's prices", async () => {
    // The mock reports a thousand prompt tokens. Priced at paid rates that
    // would show a confident dollar figure in the staff console for money
    // nobody is being charged.
    script = [{ content: "ok" }];
    const result = await run("hello");
    expect(result.provider).toBe("groq");
    expect(result.costMicroUsd).toBe(0);
  });
});

describe("streaming", () => {
  const collect = async (message: string) => {
    const events: AgentEvent[] = [];
    for await (const event of runAgentStream([], message, {
      conversationId: crypto.randomUUID(),
    })) {
      events.push(event);
    }
    return events;
  };

  it("emits the reply in pieces, not as one lump", async () => {
    script = [{ content: "We open at eight every morning" }];
    const events = await collect("what time do you open?");

    const deltas = events.filter((e) => e.type === "text");
    // Six words in, so more than one delta out. One delta would mean the
    // stream was assembled server-side and the wait was never removed.
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((d) => (d as { delta: string }).delta).join("").trim()).toBe(
      "We open at eight every morning",
    );
  });

  it("finishes with the whole reply, matching what it streamed", async () => {
    script = [{ content: "We open at eight every morning" }];
    const events = await collect("what time do you open?");

    const done = events.at(-1) as { type: "done"; result: { reply: string } };
    expect(done.type).toBe("done");
    expect(done.result.reply).toBe("We open at eight every morning");
  });

  it("reassembles tool arguments split across chunks", async () => {
    // The mock deliberately splits every argument string in half.
    script = [
      { tool_calls: [toolCall("c1", "search_menu", { query: "coffee" })] },
      { content: "Here you go." },
    ];
    const result = await run("coffee?");

    expect(result.toolTrace[0]!.name).toBe("search_menu");
    // Proof the halves were joined: a truncated string would have parsed to {}.
    expect(result.toolTrace[0]!.input).toEqual({ query: "coffee" });
  });

  it("announces a running tool in words a customer can read", async () => {
    script = [
      { tool_calls: [toolCall("c1", "search_menu", { query: "coffee" })] },
      { content: "Here you go." },
    ];
    const events = await collect("coffee?");

    const tools = events.filter((e) => e.type === "tool") as { label: string }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]!.label).toBe("Looking at the menu");
    // Never the raw tool name: "search_menu" is not something to show a person.
    expect(tools[0]!.label).not.toContain("_");
  });

  it("streams the refusal too, rather than leaving the bubble empty", async () => {
    script = [
      {
        tool_calls: [
          toolCall("c1", "place_order", {
            items: [{ slug: "flat-white", quantity: 1 }],
            orderType: "TAKEAWAY",
            paymentMethod: "CASH",
            customerName: "Test",
            customerPhone: "03001234567",
          }),
        ],
      },
      { content: "Shall I go ahead and place that?" },
    ];
    const events = await collect("order me a flat white");

    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { delta: string }).delta)
      .join("");
    expect(text).toContain("Shall I go ahead");
  });
});

describe("the two transports agree", () => {
  it("produces the same answer streamed as whole", async () => {
    // The reason requestBody() is shared: a difference between the paths
    // would mean the assistant behaves differently depending on which
    // transport the caller happened to use.
    const provider = getProvider();
    const request = {
      system: "You are a test.",
      messages: [{ role: "user" as const, content: "hello" }],
      tools: [],
    };

    script = [{ content: "the same words either way" }];
    calls = 0;
    const whole = await provider.complete(request);

    script = [{ content: "the same words either way" }];
    calls = 0;
    let streamed: typeof whole | undefined;
    for await (const event of provider.completeStream!(request)) {
      if (event.type === "done") streamed = event.response;
    }

    expect(streamed!.text).toBe(whole.text);
    expect(streamed!.toolCalls).toEqual(whole.toolCalls);
    expect(streamed!.refused).toBe(whole.refused);
  });

  it("sends identical tools and temperature down both paths", async () => {
    const provider = getProvider();
    const request = {
      system: "S",
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [],
    };

    script = [{ content: "ok" }];
    received = [];
    await provider.complete(request);
    for await (const _ of provider.completeStream!(request)) { /* drain */ }

    const [whole, streamed] = received as Record<string, unknown>[];
    expect(streamed!.temperature).toBe(whole!.temperature);
    expect(streamed!.messages).toEqual(whole!.messages);
    expect(streamed!.tools).toEqual(whole!.tools);
    // The only intended difference.
    expect(whole!.stream).toBeUndefined();
    expect(streamed!.stream).toBe(true);
  });
});
