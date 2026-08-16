# CLAUDE.md

Guidance for Claude Code (and any AI agent) working in this repository.

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
