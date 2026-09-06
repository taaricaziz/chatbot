#!/usr/bin/env node
/**
 * Production preflight.
 *
 * Fails loudly on the things that are silently fine in development and
 * broken in production — a missing session secret, an unset database, a
 * default drain token. Run before deploying.
 */
const problems = [];
const warnings = [];

const req = (name, why) => {
  if (!process.env[name] || process.env[name].trim() === "") {
    problems.push(`${name} is not set — ${why}`);
  }
};
const want = (name, why) => {
  if (!process.env[name] || process.env[name].trim() === "") {
    warnings.push(`${name} is not set — ${why}`);
  }
};

req("NEXT_PUBLIC_SITE_URL", "canonical URLs, OpenGraph and the sitemap will point at localhost");

// Present but pointing at a dev machine is worse than absent: it passes a
// presence check and then ships canonical tags and OpenGraph URLs that no
// crawler or social preview can reach.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(siteUrl)) {
  problems.push(
    `NEXT_PUBLIC_SITE_URL is "${siteUrl}" — canonical tags, OpenGraph images ` +
      "and the sitemap would all point at a machine nobody else can reach.",
  );
} else if (siteUrl && !siteUrl.startsWith("https://")) {
  warnings.push(`NEXT_PUBLIC_SITE_URL is not https (${siteUrl}).`);
}
req("STAFF_SESSION_SECRET", "the staff console cannot sign sessions");
req("STAFF_EMAIL", "nobody can sign in to the console");
req("STAFF_PASSWORD_HASH", "nobody can sign in to the console");

want("DATABASE_URL", "orders, bookings and sessions will be held IN MEMORY and lost on every restart");

// The assistant: any ONE provider key will do, and the free ones are tried
// first. Checked as a group rather than by name, so adding a free key is a
// complete answer to this warning.
const PROVIDER_KEYS = {
  GROQ_API_KEY: "groq",
  GEMINI_API_KEY: "gemini",
  GOOGLE_API_KEY: "gemini",
  CEREBRAS_API_KEY: "cerebras",
  OPENROUTER_API_KEY: "openrouter",
  ANTHROPIC_API_KEY: "anthropic",
  AGENT_API_KEY: "whichever AGENT_PROVIDER names",
};
const configured = Object.keys(PROVIDER_KEYS).filter(
  (name) => process.env[name] && process.env[name].trim() !== "",
);
const pinned = (process.env.AGENT_PROVIDER ?? "").trim().toLowerCase();

if (configured.length === 0 && pinned !== "ollama") {
  warnings.push(
    "No model provider key is set — the assistant will be unavailable. " +
      "A free key from console.groq.com/keys or aistudio.google.com/apikey " +
      "is enough; free providers are preferred automatically.",
  );
} else if (configured.length > 0) {
  const free = configured.filter((name) => PROVIDER_KEYS[name] !== "anthropic");
  if (free.length === 0 && !pinned) {
    warnings.push(
      "Only a PAID provider key is set (ANTHROPIC_API_KEY). Every message " +
        "will be billed. Add a free key to switch automatically.",
    );
  }
}

if (pinned === "openrouter" && !(process.env.AGENT_MODEL ?? "").trim()) {
  problems.push(
    "AGENT_PROVIDER is openrouter but AGENT_MODEL is unset — OpenRouter's " +
      "free model IDs rotate, so there is no safe default to fall back on.",
  );
}

if (pinned === "ollama") {
  warnings.push(
    "AGENT_PROVIDER is ollama, which runs on localhost — it will not " +
      "resolve on Vercel. Use it for local development only.",
  );
}

// A spend ceiling only means something where there is a bill.
const monthly = Number(process.env.AGENT_MONTHLY_USD ?? 0);
if (monthly > 0 && !process.env.ANTHROPIC_API_KEY) {
  warnings.push(
    "AGENT_MONTHLY_USD is set but the provider is a free tier, so it will " +
      "never bind. The daily call cap is what limits usage there.",
  );
}
want("NOTIFY_CRON_SECRET", "the notification drain endpoint stays disabled, so nothing is ever sent");
want("RESEND_FROM", "emails fall back to console logging");

const secret = process.env.STAFF_SESSION_SECRET ?? "";
if (secret && secret.length < 32) {
  problems.push("STAFF_SESSION_SECRET is shorter than 32 characters");
}

const hash = process.env.STAFF_PASSWORD_HASH ?? "";
if (hash && hash.split(":").length !== 3) {
  problems.push(
    "STAFF_PASSWORD_HASH is malformed — expected scrypt:salt:hash. " +
      "Note the separators are COLONS: dotenv expands $ inside .env values.",
  );
}

if ((process.env.NOTIFY_CRON_SECRET ?? "").startsWith("dev-")) {
  problems.push("NOTIFY_CRON_SECRET still looks like the development value");
}

for (const w of warnings) console.log(`  degraded  ${w}`);
for (const p of problems) console.log(`  BLOCKING  ${p}`);

if (problems.length > 0) {
  console.log(`\n${problems.length} blocking problem(s). Not ready to deploy.`);
  process.exit(1);
}
console.log(
  warnings.length
    ? `\nNo blocking problems. ${warnings.length} feature(s) will run degraded.`
    : "\nReady to deploy.",
);
