import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseArguments,
  PROVIDERS,
  resolveProvider,
  toOpenAiMessages,
  toOpenAiTools,
  type ConversationMessage,
} from "@/agent/provider";

const KEYS = [
  "AGENT_PROVIDER",
  "AGENT_MODEL",
  "GROQ_MODEL",
  "GEMINI_MODEL",
  "ANTHROPIC_MODEL",
  "AGENT_API_KEY",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "CEREBRAS_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("choosing a provider", () => {
  it("returns nothing when no key is set at all", () => {
    expect(resolveProvider()).toBeNull();
  });

  it("picks a free provider from its key alone", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const resolved = resolveProvider();
    expect(resolved?.id).toBe("groq");
    expect(resolved?.free).toBe(true);
  });

  it("prefers a FREE provider when both are available", () => {
    // The point of the phase: paid stays possible, free is the default.
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.GEMINI_API_KEY = "aiza-test";
    expect(resolveProvider()?.id).toBe("gemini");
    expect(resolveProvider()?.free).toBe(true);
  });

  it("lets an explicit choice override the free-first order", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.AGENT_PROVIDER = "anthropic";
    expect(resolveProvider()?.id).toBe("anthropic");
  });

  it("resolves an explicitly named provider even with no key, so the error can name it", () => {
    process.env.AGENT_PROVIDER = "cerebras";
    expect(resolveProvider()?.id).toBe("cerebras");
  });

  it("ignores a provider nobody has heard of", () => {
    process.env.AGENT_PROVIDER = "not-a-provider";
    expect(resolveProvider()).toBeNull();
  });

  it("accepts the generic AGENT_API_KEY for any OpenAI-compatible provider", () => {
    process.env.AGENT_PROVIDER = "groq";
    process.env.AGENT_API_KEY = "shared-key";
    expect(resolveProvider()?.id).toBe("groq");
  });

  it("requires an explicit model where free IDs rotate", () => {
    // OpenRouter names free models with a `:free` suffix that changes.
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(resolveProvider()).toBeNull();
    process.env.AGENT_MODEL = "some/model:free";
    expect(resolveProvider()?.id).toBe("openrouter");
  });

  it("lets AGENT_MODEL override a default", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.AGENT_MODEL = "llama-3.1-8b-instant";
    expect(resolveProvider()?.model).toBe("llama-3.1-8b-instant");
  });

  it("ignores a model name that belongs to a DIFFERENT provider", () => {
    // The trap this exists for: an existing AGENT_MODEL=claude-opus-5 survives
    // the switch to a free key, and Groq is asked for a Claude model.
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.AGENT_MODEL = "claude-opus-5";
    const resolved = resolveProvider();
    expect(resolved?.id).toBe("groq");
    expect(resolved?.model).not.toBe("claude-opus-5");
    expect(resolved?.model).toBe(PROVIDERS.groq!.defaultModel);
  });

  it("honours AGENT_MODEL when it does not belong to anyone else", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.AGENT_MODEL = "llama-3.1-8b-instant";
    expect(resolveProvider()?.model).toBe("llama-3.1-8b-instant");
  });

  it("honours a claude model name when the provider IS anthropic", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.AGENT_PROVIDER = "anthropic";
    process.env.AGENT_MODEL = "claude-opus-5";
    expect(resolveProvider()?.model).toBe("claude-opus-5");
  });

  it("lets a provider-scoped model win over the generic one", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.AGENT_MODEL = "some-other-model";
    process.env.GROQ_MODEL = "llama-3.3-70b-versatile";
    expect(resolveProvider()?.model).toBe("llama-3.3-70b-versatile");
  });

  it("marks only Anthropic as not free", () => {
    for (const [id, catalogue] of Object.entries(PROVIDERS)) {
      expect(catalogue.free, id).toBe(id !== "anthropic");
    }
  });
});

describe("translating tools to the OpenAI shape", () => {
  const tools = [
    {
      name: "search_menu",
      description: "Find dishes.",
      input_schema: {
        type: "object" as const,
        properties: { query: { type: "string" } },
      },
    },
  ];

  it("keeps the schema intact — the tool contract must not drift per provider", () => {
    const [converted] = toOpenAiTools(tools) as {
      type: string;
      function: { name: string; description: string; parameters: unknown };
    }[];
    expect(converted!.type).toBe("function");
    expect(converted!.function.name).toBe("search_menu");
    expect(converted!.function.parameters).toEqual(tools[0]!.input_schema);
  });
});

describe("translating a conversation", () => {
  it("puts the system prompt first", () => {
    const out = toOpenAiMessages("RULES", []) as { role: string }[];
    expect(out[0]!.role).toBe("system");
  });

  it("serialises tool arguments as a JSON string, as the shape demands", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "price_cart", input: { items: [] } }],
      },
    ];
    const out = toOpenAiMessages("S", messages) as {
      tool_calls?: { function: { arguments: string } }[];
    }[];
    const args = out[1]!.tool_calls![0]!.function.arguments;
    expect(typeof args).toBe("string");
    expect(JSON.parse(args)).toEqual({ items: [] });
  });

  it("never emits a null content beside tool_calls — some providers reject it", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "x", input: {} }] },
    ];
    const out = toOpenAiMessages("S", messages) as { content?: unknown }[];
    expect(out[1]!.content).toBe("");
  });

  it("gives tool results their own role, not a user message", () => {
    const messages: ConversationMessage[] = [
      { role: "tool", toolCallId: "c1", name: "price_cart", content: "{}", isError: false },
    ];
    const out = toOpenAiMessages("S", messages) as { role: string; tool_call_id?: string }[];
    expect(out[1]!.role).toBe("tool");
    expect(out[1]!.tool_call_id).toBe("c1");
  });
});

describe("arguments from a weaker model", () => {
  it("parses ordinary JSON", () => {
    expect(parseArguments('{"slug":"flat-white"}')).toEqual({ slug: "flat-white" });
  });

  it("survives broken JSON instead of ending the conversation", () => {
    // A stray comma must become a recoverable tool refusal, not a 500.
    expect(parseArguments('{"slug":"x",}')).toEqual({});
  });

  it("treats an empty argument string as no arguments", () => {
    expect(parseArguments("")).toEqual({});
    expect(parseArguments("   ")).toEqual({});
  });

  it("refuses a bare JSON array or scalar, which is not an argument object", () => {
    expect(parseArguments("[1,2,3]")).toEqual({});
    expect(parseArguments('"hello"')).toEqual({});
    expect(parseArguments("null")).toEqual({});
  });
});
