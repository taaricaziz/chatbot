import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentBrain,
  agentEnabled,
  describeBrain,
} from "@/lib/agent-config";
import { cafeBotUrl } from "@/lib/channels/cafebot";
import { setSwitch } from "@/lib/repositories/agent-switch";

const KEYS = [
  "AGENT_BRAIN",
  "CAFEBOT_URL",
  "AGENT_ENABLED",
  "AGENT_PROVIDER",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "CEREBRAS_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "AGENT_API_KEY",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  setSwitch(false, "test");
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setSwitch(false, "test");
});

describe("choosing a brain", () => {
  it("defaults to the local agent", () => {
    expect(agentBrain()).toBe("local");
  });

  it("uses CafeBot when asked to and it is reachable by configuration", () => {
    process.env.AGENT_BRAIN = "cafebot";
    process.env.CAFEBOT_URL = "https://cafebot.example";
    expect(agentBrain()).toBe("cafebot");
  });

  it("falls back to local when CafeBot is asked for but has no URL", () => {
    // Answering nothing would be worse than answering with the other brain.
    process.env.AGENT_BRAIN = "cafebot";
    expect(agentBrain()).toBe("local");
  });

  it("is case-insensitive about the setting", () => {
    process.env.AGENT_BRAIN = "  CafeBot ";
    process.env.CAFEBOT_URL = "https://cafebot.example";
    expect(agentBrain()).toBe("cafebot");
  });

  it("treats anything else as local", () => {
    process.env.AGENT_BRAIN = "banana";
    expect(agentBrain()).toBe("local");
  });
});

describe("the URL", () => {
  it("strips trailing slashes so paths join cleanly", () => {
    process.env.CAFEBOT_URL = "https://cafebot.example///";
    expect(cafeBotUrl()).toBe("https://cafebot.example");
  });

  it("is null when unset or blank", () => {
    expect(cafeBotUrl()).toBeNull();
    process.env.CAFEBOT_URL = "   ";
    expect(cafeBotUrl()).toBeNull();
  });
});

describe("the gate, with CafeBot answering", () => {
  it("is on with CafeBot configured and NO model provider key at all", () => {
    // The whole point: CafeBot brings its own model.
    process.env.AGENT_BRAIN = "cafebot";
    process.env.CAFEBOT_URL = "https://cafebot.example";
    expect(agentEnabled()).toBe(true);
  });

  it("is off with neither a provider key nor CafeBot", () => {
    expect(agentEnabled()).toBe(false);
  });

  it("still obeys the operator's explicit off", () => {
    process.env.AGENT_BRAIN = "cafebot";
    process.env.CAFEBOT_URL = "https://cafebot.example";
    process.env.AGENT_ENABLED = "false";
    expect(agentEnabled()).toBe(false);
  });

  it("still obeys the staff kill switch", () => {
    process.env.AGENT_BRAIN = "cafebot";
    process.env.CAFEBOT_URL = "https://cafebot.example";
    setSwitch(true, "test");
    expect(agentEnabled()).toBe(false);
  });
});

describe("what the console says is answering", () => {
  it("names CafeBot by its host, and never calls it free", () => {
    process.env.AGENT_BRAIN = "cafebot";
    process.env.CAFEBOT_URL = "https://cafebot-dun.vercel.app/";
    expect(describeBrain()).toEqual({
      id: "cafebot",
      model: "cafebot-dun.vercel.app",
      // CafeBot runs on Anthropic. Showing "free tier" would be a lie.
      free: false,
    });
  });

  it("falls through to the model provider when local", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    expect(describeBrain()?.id).toBe("groq");
  });
});
