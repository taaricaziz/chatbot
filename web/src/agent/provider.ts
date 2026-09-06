import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "@/lib/services/spend";

/**
 * Which model actually answers.
 *
 * The assistant was built against Anthropic. Running it on a free tier
 * instead should be a config change, not a rewrite — so the loop talks to
 * this interface and nothing above it knows which provider is behind it.
 *
 * Groq, Gemini, Cerebras and OpenRouter all speak the OpenAI
 * chat-completions shape, so ONE adapter covers every free option worth
 * having. That is the reason to target that shape rather than pick a
 * provider: free tiers change their limits, throttle, or disappear, and the
 * answer to that should be editing an env var.
 *
 * WHAT DOES NOT CHANGE: a weaker model is worse at conversation, not more
 * dangerous. It still cannot produce a wrong total or a phantom order,
 * because it does not compute totals or save orders — services/ does, and it
 * re-prices everything and refuses without an explicit confirmation. That is
 * the return on the service layer, collected here.
 */

export interface NormalisedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ConversationMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: NormalisedToolCall[] }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
      isError: boolean;
    };

export interface ProviderResponse {
  text: string;
  toolCalls: NormalisedToolCall[];
  usage: TokenUsage;
  /** The model declined the request outright, rather than answering. */
  refused: boolean;
  /**
   * The model hit its token ceiling mid-thought. Distinct from having
   * nothing to say, and the two need different replies.
   */
  truncated?: boolean;
}

export type ProviderStreamEvent =
  | { type: "text"; delta: string }
  | { type: "done"; response: ProviderResponse };

export interface ProviderRequest {
  system: string;
  messages: ConversationMessage[];
  tools: Anthropic.Tool[];
}

export interface Provider {
  id: string;
  model: string;
  /** True when this provider is being used on a no-cost tier. */
  free: boolean;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
  /**
   * Optional. Where a provider does not implement it the loop falls back to
   * `complete()` and emits the finished text as one delta, so the caller
   * never has to care which it got — the conversation just appears at once
   * instead of word by word.
   */
  completeStream?(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent>;
}

export class AgentUnavailableError extends Error {
  /**
   * True when waiting would plausibly fix it — a free tier's per-minute
   * window, not a missing key. The customer deserves different words for
   * "try again shortly" and "this is off".
   */
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

// ---------------------------------------------------------------------------
// Provider catalogue
// ---------------------------------------------------------------------------

interface Catalogue {
  baseUrl: string;
  envKeys: string[];
  /**
   * Default model. Left undefined where documented free model IDs rotate
   * often enough that guessing one would fail confusingly — those providers
   * require AGENT_MODEL to be set explicitly.
   */
  defaultModel?: string;
  free: boolean;
  /** Some local runtimes authenticate nothing at all. */
  keyOptional?: boolean;
  /** Where to get a key, quoted verbatim in the error when one is missing. */
  keyUrl: string;
}

export const PROVIDERS: Record<string, Catalogue> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    envKeys: ["GROQ_API_KEY", "AGENT_API_KEY"],
    // Verified against the live /models list. Groq retired the Llama chat
    // models, which is precisely why a stale default has to fail loudly —
    // see failFor(), which lists what is actually available.
    defaultModel: "openai/gpt-oss-120b",
    free: true,
    keyUrl: "https://console.groq.com/keys",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "AGENT_API_KEY"],
    defaultModel: "gemini-2.5-flash",
    free: true,
    keyUrl: "https://aistudio.google.com/apikey",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    envKeys: ["CEREBRAS_API_KEY", "AGENT_API_KEY"],
    defaultModel: "llama-3.3-70b",
    free: true,
    keyUrl: "https://cloud.cerebras.ai",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    envKeys: ["OPENROUTER_API_KEY", "AGENT_API_KEY"],
    // OpenRouter's free model IDs carry a `:free` suffix and rotate; naming
    // one here would break quietly when it is retired.
    free: true,
    keyUrl: "https://openrouter.ai/keys",
  },
  ollama: {
    // Runs on the machine, costs nothing, needs no account and no key. It
    // cannot be deployed to Vercel — this is the local-development answer,
    // and the reason AGENT_BASE_URL exists.
    baseUrl: "http://localhost:11434/v1",
    envKeys: ["OLLAMA_API_KEY", "AGENT_API_KEY"],
    defaultModel: "llama3.1",
    free: true,
    keyOptional: true,
    keyUrl: "https://ollama.com/download",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    envKeys: ["ANTHROPIC_API_KEY"],
    defaultModel: "claude-opus-5",
    free: false,
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
};

/** Free providers first — this is the order auto-detection tries. */
const AUTO_ORDER = ["groq", "gemini", "cerebras", "openrouter", "anthropic"];
// Deliberately NOT in AUTO_ORDER: it needs no key, so auto-detection would
// always "find" it and the site would silently talk to a port with nothing
// behind it. Opt in with AGENT_PROVIDER=ollama.

function keyFor(catalogue: Catalogue): string | undefined {
  for (const name of catalogue.envKeys) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export interface ResolvedProvider {
  id: string;
  model: string;
  free: boolean;
}

/**
 * Which provider will be used, and why — without constructing anything.
 *
 * Exported separately so the preflight check and the staff console can report
 * the answer without a key having to be valid.
 */
/**
 * Model names are not portable, and AGENT_MODEL is a single global.
 *
 * Without this, an existing `AGENT_MODEL=claude-opus-5` silently survives the
 * switch to a free provider and Groq is asked for a Claude model — a 400 that
 * reads like the integration is broken when it is only misconfigured. A name
 * that unambiguously belongs to a DIFFERENT provider is therefore ignored in
 * favour of that provider's own default.
 */
const MODEL_PREFIXES: Record<string, string> = {
  "claude-": "anthropic",
  "gemini-": "gemini",
};

function modelFor(id: string, catalogue: Catalogue): string | undefined {
  // Provider-scoped wins: GROQ_MODEL, GEMINI_MODEL, and so on. Unambiguous,
  // and survives switching provider back and forth.
  const scoped = process.env[`${id.toUpperCase()}_MODEL`]?.trim();
  if (scoped) return scoped;

  const generic = process.env.AGENT_MODEL?.trim();
  if (generic) {
    const belongsTo = Object.entries(MODEL_PREFIXES).find(([prefix]) =>
      generic.startsWith(prefix),
    )?.[1];

    if (belongsTo && belongsTo !== id) {
      console.warn(
        `[agent] Ignoring AGENT_MODEL="${generic}" — it is a ${belongsTo} ` +
          `model and the provider is ${id}. Using ${catalogue.defaultModel} ` +
          `instead. Set ${id.toUpperCase()}_MODEL to choose explicitly.`,
      );
    } else {
      return generic;
    }
  }

  return catalogue.defaultModel;
}

export function resolveProvider(): ResolvedProvider | null {
  const explicit = process.env.AGENT_PROVIDER?.trim().toLowerCase();
  const candidates = explicit ? [explicit] : AUTO_ORDER;

  for (const id of candidates) {
    const catalogue = PROVIDERS[id];
    if (!catalogue) continue;
    // An explicitly named provider is reported even without a key, so the
    // resulting error names the provider the operator actually chose.
    if (!explicit && !keyFor(catalogue)) continue;

    const model = modelFor(id, catalogue);
    if (!model) continue;

    return { id, model, free: catalogue.free };
  }

  return null;
}

export function getProvider(): Provider {
  const resolved = resolveProvider();

  if (!resolved) {
    throw new AgentUnavailableError(
      "No model provider is configured. Set one free API key — " +
        "GROQ_API_KEY, GEMINI_API_KEY or CEREBRAS_API_KEY — and the " +
        "assistant picks it up automatically.",
    );
  }

  const catalogue = PROVIDERS[resolved.id]!;
  const apiKey = keyFor(catalogue);

  if (!apiKey && !catalogue.keyOptional) {
    throw new AgentUnavailableError(
      `AGENT_PROVIDER is "${resolved.id}" but none of ` +
        `${catalogue.envKeys.join(", ")} is set. Get a key at ${catalogue.keyUrl}.`,
    );
  }

  if (resolved.id === "anthropic") {
    return anthropicProvider(resolved.model, apiKey!);
  }

  // Lets a self-hosted runtime, a proxy, or a test double stand in for any
  // OpenAI-compatible provider without a code change.
  const baseUrl = process.env.AGENT_BASE_URL?.trim() || catalogue.baseUrl;
  return openAiCompatibleProvider(resolved, baseUrl, apiKey ?? "no-key");
}

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter — Groq, Gemini, Cerebras, OpenRouter
// ---------------------------------------------------------------------------

interface OpenAiToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export function toOpenAiMessages(
  system: string,
  messages: ConversationMessage[],
): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];

  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const entry: Record<string, unknown> = {
        role: "assistant",
        // Some providers reject a null content alongside tool_calls; an empty
        // string is accepted everywhere.
        content: message.content || "",
      };
      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        }));
      }
      out.push(entry);
      continue;
    }

    // Tool results are their own role here, unlike Anthropic where they ride
    // inside a user message.
    out.push({
      role: "tool",
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    });
  }

  return out;
}

export function toOpenAiTools(tools: Anthropic.Tool[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

/** Arguments arrive as a JSON STRING here, and a weak model can emit broken JSON. */
export function parseArguments(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    // `typeof [] === "object"`, so the array check is not redundant: a model
    // emitting a bare array must not be handed to a tool as its arguments.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Returning {} rather than throwing lets the tool refuse on its own
    // validation and tell the model what it got wrong, which is recoverable.
    // Throwing here would end a conversation over a stray comma.
    return {};
  }
}

/**
 * The request body, built in ONE place.
 *
 * The streaming and non-streaming paths must send identical tools, an
 * identical system prompt and an identical temperature — a difference
 * between them would mean the assistant behaves differently depending on
 * which transport the caller happened to use.
 */
function requestBody(
  model: string,
  { system, messages, tools }: ProviderRequest,
  stream: boolean,
): string {
  return JSON.stringify({
    model,
    // Reasoning models (Groq's gpt-oss family among them) spend this budget
    // on a hidden `reasoning` field BEFORE writing a word of the answer.
    // Verified: at 80 tokens the whole budget went to reasoning and `content`
    // came back empty with finish_reason "length" — which reaches a customer
    // as an assistant that says nothing. Roomy on purpose.
    max_tokens: 8192,
    // Low but not zero: consistent about prices, warm about everything else.
    temperature: 0.3,
    messages: toOpenAiMessages(system, messages),
    tools: toOpenAiTools(tools),
    ...(stream
      ? {
          stream: true,
          // Asks for a final usage chunk. Not every provider honours it; the
          // meter counts CALLS, so missing token counts cost nothing that
          // matters.
          stream_options: { include_usage: true },
        }
      : {}),
  });
}

async function failFor(
  id: string,
  response: Response,
  baseUrl?: string,
  apiKey?: string,
): Promise<never> {
  const detail = await response.text().catch(() => "");

  // A free tier saying "slow down" is not a bug and should not read like one
  // in the logs.
  if (response.status === 429) {
    throw new AgentUnavailableError(
      `${id} is rate limiting us (free tier). ${detail.slice(0, 200)}`,
      true,
    );
  }

  // Model catalogues change without notice — Groq retired every Llama chat
  // model between one release and the next. A bare 404 reads like a broken
  // integration, so this asks the provider what it DOES have and says so.
  if (detail.includes("model_not_found") && baseUrl && apiKey) {
    const available = await listModels(baseUrl, apiKey);
    throw new AgentUnavailableError(
      `${id} does not have that model. Set ${id.toUpperCase()}_MODEL to one of: ` +
        `${available.join(", ") || "(could not list models)"}`,
    );
  }

  throw new AgentUnavailableError(
    `${id} returned ${response.status}. ${detail.slice(0, 200)}`,
  );
}

/** Best effort: a failure to list must not replace the original error. */
async function listModels(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id).sort();
  } catch {
    return [];
  }
}

/** Tool calls arrive in fragments, keyed by index, and must be reassembled. */
interface PartialToolCall {
  id: string;
  name: string;
  args: string;
}

function assembleToolCalls(parts: Map<number, PartialToolCall>): NormalisedToolCall[] {
  return [...parts.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, part]) => part.name)
    .map(([index, part]) => ({
      id: part.id || `call_${index}`,
      name: part.name,
      input: parseArguments(part.args),
    }));
}

function openAiCompatibleProvider(
  resolved: ResolvedProvider,
  baseUrl: string,
  apiKey: string,
): Provider {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const url = `${baseUrl}/chat/completions`;

  return {
    id: resolved.id,
    model: resolved.model,
    free: resolved.free,

    async complete(request) {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: requestBody(resolved.model, request, false),
      });

      if (!response.ok) await failFor(resolved.id, response, baseUrl, apiKey);

      const body = (await response.json()) as {
        choices?: {
          message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
          finish_reason?: string;
        }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };

      const choice = body.choices?.[0];
      const rawCalls = choice?.message?.tool_calls ?? [];
      const cached = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;

      return {
        text: (choice?.message?.content ?? "").trim(),
        toolCalls: rawCalls
          .filter((call) => call.function?.name)
          .map((call, index) => ({
            // Gemini has been known to omit the id; the loop needs one to
            // match a result back to its call.
            id: call.id || `call_${index}`,
            name: call.function.name,
            input: parseArguments(call.function.arguments),
          })),
        usage: {
          inputTokens: Math.max(0, (body.usage?.prompt_tokens ?? 0) - cached),
          outputTokens: body.usage?.completion_tokens ?? 0,
          cacheReadInputTokens: cached,
        },
        refused: choice?.finish_reason === "content_filter",
        truncated: choice?.finish_reason === "length",
      };
    },

    async *completeStream(request) {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: requestBody(resolved.model, request, true),
      });

      if (!response.ok) await failFor(resolved.id, response, baseUrl, apiKey);
      if (!response.body) {
        throw new AgentUnavailableError(
          `${resolved.id} returned no response body to stream.`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let text = "";
      let finishReason = "";
      const toolParts = new Map<number, PartialToolCall>();
      let usage: ProviderResponse["usage"] = { inputTokens: 0, outputTokens: 0 };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Server-sent events are newline-delimited. A chunk can split a
          // line in half, so only whole lines are consumed and the remainder
          // stays in the buffer.
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);

            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;

            let chunk: {
              choices?: {
                delta?: {
                  content?: string | null;
                  tool_calls?: {
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }[];
                };
                finish_reason?: string | null;
              }[];
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                prompt_tokens_details?: { cached_tokens?: number };
              };
            };

            try {
              chunk = JSON.parse(payload);
            } catch {
              // A malformed chunk is not worth ending a conversation over.
              continue;
            }

            if (chunk.usage) {
              const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
              usage = {
                inputTokens: Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cached),
                outputTokens: chunk.usage.completion_tokens ?? 0,
                cacheReadInputTokens: cached,
              };
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta?.content;
            if (delta) {
              text += delta;
              yield { type: "text", delta };
            }

            for (const [i, part] of (choice.delta?.tool_calls ?? []).entries()) {
              const index = part.index ?? i;
              const existing =
                toolParts.get(index) ?? { id: "", name: "", args: "" };
              toolParts.set(index, {
                id: part.id || existing.id,
                name: part.function?.name || existing.name,
                // Arguments stream in as string fragments and are only valid
                // JSON once concatenated.
                args: existing.args + (part.function?.arguments ?? ""),
              });
            }
          }
        }
      } finally {
        // Releases the socket whether the stream finished or the caller
        // stopped consuming.
        reader.releaseLock();
      }

      yield {
        type: "done",
        response: {
          text: text.trim(),
          toolCalls: assembleToolCalls(toolParts),
          usage,
          refused: finishReason === "content_filter",
          truncated: finishReason === "length",
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic adapter — same interface, native shape
// ---------------------------------------------------------------------------

function anthropicProvider(model: string, apiKey: string): Provider {
  return {
    id: "anthropic",
    model,
    free: false,

    async complete({ system, messages, tools }) {
      // Imported lazily so the SDK is not loaded at all on a free tier.
      const { default: SDK } = await import("@anthropic-ai/sdk");
      const client = new SDK({ apiKey });

      const wire = messages.map((message) => {
        if (message.role === "user") {
          return { role: "user" as const, content: message.content };
        }
        if (message.role === "assistant") {
          const blocks: unknown[] = [];
          if (message.content) blocks.push({ type: "text", text: message.content });
          for (const call of message.toolCalls ?? []) {
            blocks.push({
              type: "tool_use",
              id: call.id,
              name: call.name,
              input: call.input,
            });
          }
          return { role: "assistant" as const, content: blocks as never };
        }
        return {
          role: "user" as const,
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId,
              content: message.content,
              ...(message.isError ? { is_error: true } : {}),
            },
          ] as never,
        };
      });

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        system: [
          {
            type: "text",
            text: system,
            // Identical on every turn, so caching it makes each message in a
            // conversation markedly cheaper.
            cache_control: { type: "ephemeral" },
          },
        ],
        tools,
        messages: wire,
      });

      return {
        text: response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim(),
        toolCalls: response.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({
            id: b.id,
            name: b.name,
            input: b.input as Record<string, unknown>,
          })),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        },
        refused: response.stop_reason === "refusal",
      };
    },
  };
}
