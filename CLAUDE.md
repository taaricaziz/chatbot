# CLAUDE.md

Guidance for Claude Code (and any AI agent) working in this repository.

## Two applications live here

This repo now contains **two independent applications**. Read the section
that matches the files you are touching; do not apply one's rules to the
other.

| Directory | App | Rules |
| --- | --- | --- |
| `backend/`, `frontend/`, `prompts/`, `data/` | **CafeBot** — the original AI chat/SMS ordering assistant | Everything below, unchanged |
| `web/` | **Gootee Cafe website** — Next.js ordering, reservations, QR dine-in, admin | [The `web/` section](#the-gootee-cafe-website-web) at the bottom |

**CafeBot is frozen.** It works, it is deployed, and the website is being
built alongside it rather than absorbing it. Do not modify, refactor,
delete or "improve" anything outside `web/` unless explicitly asked. That
includes `vercel.json`, `package.json` at the repo root, and
`.claude/launch.json` — append to them, never rewrite them.

The two apps deliberately have **separate menus**: CafeBot reads
`data/menu.json` in USD, the website reads PostgreSQL in PKR. They are
expected to differ. Do not "sync" them without being asked.

---

# CafeBot (`backend/`, `frontend/`, `prompts/`, `data/`)

## Project Purpose

CafeBot is a beginner-friendly, low-cost AI café assistant chatbot. It helps
customers browse the menu, get simple recommendations, and place pickup or
delivery orders through a chat interface. Staff view incoming orders on a
simple dashboard.

## Architecture (Simple)

- `prompts/` — CafeBot's system prompt(s). All customer-facing behavior
  rules (menu, ordering, confirmation, safety) live here, not in code.
- `data/` — flat JSON files acting as the "database": `menu.json`,
  `promotions.json`, `orders.json`. No real database — keeps the project
  free/low-cost to run.
- `frontend/` — the chat UI (and later the staff dashboard).
- `backend/` — the API layer, primarily a single `/api/chat` endpoint that
  reads the system prompt and menu data and talks to the AI model.
- `.env.example` — names of environment variables needed (e.g. AI API key).
  Real secrets go in a local `.env` file that is never committed.

Data flow: Frontend chat → `/api/chat` → system prompt + menu/promotions
data → AI response → (later) structured order saved to `data/orders.json`.

## Coding Rules

- Keep it simple and beginner-readable. Prefer plain, explicit code over
  clever abstractions.
- Don't add a database, auth system, or paid services unless explicitly
  asked — this project is meant to stay minimal and low-cost.
- Don't build features ahead of the current step. Each task should do only
  what it's asked to do.
- Reuse `data/menu.json` and `data/promotions.json` as the single source of
  truth — never hardcode menu items, prices, or discounts in code or prompts.
- Keep the system prompt (`prompts/system-prompt.md`) as the place for
  behavior rules; keep code focused on plumbing (reading data, calling the
  API, validating input), not on deciding business rules.

## Security Rules

- Never commit real secrets. Only `.env.example` (placeholder names) is
  committed; the real `.env` file must stay untracked.
- Never print, log, or echo API keys or secrets.
- Validate all order data against `data/menu.json` before accepting it —
  never trust prices, item names, or availability claimed by the model or
  the user.
- Order totals must be calculated deterministically in code, never by the
  language model.
- Never save/finalize an order without explicit customer confirmation.

## Token-Saving Rules

- Read only the files needed for the current task — don't re-read the whole
  project on every request.
- Keep responses and generated files concise; avoid restating unchanged
  content.
- Avoid regenerating large data files (e.g. `menu.json`) when only a small
  edit is needed — use targeted edits instead.

## Scope Discipline

Modify only the files needed for the current task. Do not refactor,
reformat, or "improve" unrelated files, and do not get ahead of the current
step in the build sequence.

---

# The Gootee Cafe website (`web/`)

A Next.js 16 / React 19 / TypeScript app for a premium café site: menu
browsing, cart, checkout, QR dine-in, reservations, delivery and an admin
console. Planned in full before implementation — see the architecture plan
for the reasoning behind every choice below.

**This section overrides the CafeBot rules above for anything under
`web/`.** A database, an auth system and a real ORM are deliberate here.

## Stack

Next.js (App Router) · TypeScript strict · PostgreSQL via Prisma ·
CSS Modules with a token layer · Zod at every boundary · Vitest + Playwright.

Deployed as a **second Vercel project** with Root Directory `web/`. The
root `vercel.json` belongs to CafeBot and must keep pointing at
`backend/server.js`.

## The four invariants

These are not style preferences. Breaking one is a bug.

1. **The client never sets a price.** The cart posts item IDs, quantities
   and modifier IDs. The server re-reads every price from the database and
   recomputes. A tampered cart payload must change nothing.
2. **Money is integer paisa, never floats.** `Rs. 1,860` is `186000`.
   Formatting happens at the edge, in `lib/money.ts`.
3. **Orders are immutable snapshots.** `order_items` copies name, price and
   tax rate at time of ordering. Changing a menu price must never rewrite a
   historical order.
4. **Nothing is confirmed without an explicit act.** Applies identically to
   the web checkout and the AI agent.

## Where business rules live

`src/lib/services/` is the only place business rules exist. It imports
nothing from `src/app/` — no request objects, no React — so it can be
called from a Server Component, a route handler and an agent tool alike,
and tested without booting a server.

Route handlers under `src/app/api/` are thin validation-and-serialisation
wrappers over those services. If you find yourself computing a total in a
component or a route handler, it belongs in `services/pricing.ts`.

## Tax is not a constant

Sindh service tax is **15% on cash and 8% on card/wallet/QR**. The total
changes when the customer switches payment method at checkout. The rate is
an **input** to the pricing engine and is **stored on the order row** in
basis points, because rates change and old orders must still reconcile.

## Contact details

`src/lib/cafe.ts` is the single source of truth for name, address and
phone, used by the header, footer, contact page, location section and
`LocalBusiness` schema. Never retype an address into a component.

This is a **demonstration build**: the address and phone are deliberately
fictional and the phone is rendered without a `tel:` link. The reference
café used for research must not appear anywhere in the codebase.

## Design

Single-theme by choice — espresso-dark ground, bone type, pistachio
accent. The whole site is food photography and a dark ground makes it
glow. All colour, spacing, type-scale and motion values are tokens in
`src/app/globals.css`; components read tokens and never hardcode a hex.

## Performance budget

Enforced from the start, because retrofitting performance onto an
image-heavy site is miserable. LCP under 2.5s on simulated 4G, zero
cumulative layout shift (every food image gets explicit dimensions), under
150KB of JS on marketing routes, and no Google Maps JS SDK on the
homepage — a static map plus a directions deep link instead.

## The assistant runs on whichever model is cheapest

`web/src/agent/provider.ts` is the only file that knows which model answers.
Groq, Gemini, Cerebras, OpenRouter and a local Ollama all speak the OpenAI
chat-completions shape, so one adapter covers every free option; Anthropic
keeps its own adapter behind the same interface.

**Free providers are tried first.** Adding a free key is the whole switch —
no code change. Free-tier limits move around and published figures disagree,
so nothing depends on a particular provider's numbers: the app enforces its
own conservative cap (200 model calls per Karachi day, 40 per conversation)
and degrades with a sentence rather than an error.

### Rules that are easy to break

- **A model name is not portable.** `AGENT_MODEL=claude-opus-5` must never
  reach Groq. `modelFor()` drops a name that unambiguously belongs to another
  provider; `GROQ_MODEL`, `GEMINI_MODEL` etc. are the unambiguous way to pin
  one.
- **A free provider costs zero and must report zero.** Pricing free tokens at
  paid rates puts a confident dollar figure in the staff console for money
  nobody is charged, which is worse than showing nothing.
- **Model catalogues rot.** Groq retired every Llama chat model between one
  release and the next, so the hardcoded default 404'd. A stale model now
  fails with the list of models the provider actually has.

### The limit that actually binds (measured, September 2026)

A real Groq free key allows **1,000 requests/day** but only **8,000 tokens
per minute**. The daily call cap is not what runs out — the per-minute token
window is. One conversation cost ~6,900 tokens until `search_menu` was
trimmed to 12 results with descriptions only when the list is short; it is
now ~3,800. Keep tool results small: it is the difference between one
conversation a minute and two.

When that window is hit the customer is told the assistant is **busy, try in
a minute** — never that it is "resting", which is what a missing key means.
Different causes, different words.

### A prompt is a request; code is the guarantee

The system prompt asks the model not to emit markdown. It was tested against
a real free model and ignored — replies still came back full of `**bold**`,
which a plain-text bubble renders as literal asterisks. `lib/text.ts`
strips it, on the client as it streams and on the server before the
transcript is stored, so both read the same words.

The same principle, one layer up, is why the service layer exists at all.

### The kill switch must not need a deploy

Marketing routes are statically rendered, so a gate evaluated in a Server
Component is baked in at BUILD time — `AGENT_ENABLED=false` would have left
the widget on the page, erroring, until the next deploy. The widget therefore
asks `/api/agent/status` (dynamic) and hides itself, which keeps those pages
static AND makes the staff console's off switch take effect on the next
request. Do not move that decision back into the layout.

None of this touches safety. A weaker model is worse at conversation, not
more dangerous: it does not compute totals or save orders — `services/` does,
and it re-prices from the menu and refuses without an explicit confirmation.
That guarantee is what makes swapping the model a config change.

## The database is live

Supabase project `okopmkyxractmwzejwrz` (`gootee-cafe`), region ap-southeast-1.
Seeded and verified: orders survive a restart.

**The pooler host is `aws-0-ap-southeast-1`, not `aws-1`.** This cost real
time. `aws-1` answers, completes TLS, and then says "tenant/user not found",
which reads like an authentication failure rather than a wrong address. If a
connection looks impossible, check the host before the credentials.

The site connects as **`gootee_app`**, not the postgres superuser: SELECT /
INSERT / UPDATE / DELETE plus `BYPASSRLS`, and no DDL rights. Migrations are
applied separately and deliberately. `BYPASSRLS` is required because every
table has RLS enabled with no policies — correct for the anon key, which then
reads nothing, and fatal for the app without it.

Use `?pgbouncer=true` on port 6543: the transaction pooler cannot hold
prepared statements across connections.

**Migrations live in Supabase's history, not in the repo.** Grepping the
working tree for the CHECK and EXCLUDE constraints finds nothing and it is
easy to conclude wrongly that they were never written. Ask the database:

```sql
select conrelid::regclass, conname, pg_get_constraintdef(oid)
from pg_constraint where contype in ('c','x');
```

`no_double_booking` is a GiST exclusion constraint over
`tstzrange(starts_at, ends_at)` — half-open, so back-to-back sittings stay
bookable — skipping CANCELLED and NO_SHOW. Do not add a second one.

A free Supabase project pauses after about a week idle. If the site suddenly
cannot connect, check whether the project needs restoring before debugging
anything else.

## Scope discipline

Build only the current phase. Each phase ends deployable. Do not get ahead
of the build sequence, and do not touch anything outside `web/`.
