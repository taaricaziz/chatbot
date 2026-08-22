# Gootee Cafe

An AI café assistant chatbot — helps customers browse the menu, get
recommendations, and place pickup or delivery orders through a chat
interface. Staff track incoming orders on a simple dashboard.

## Folder Structure

- `prompts/` — CafeBot's system prompt, defining its persona, ordering
  rules, and safety guardrails
- `data/` — flat JSON files acting as the "database": `menu.json`,
  `promotions.json`, `orders.json` (no real database)
- `frontend/` — the customer chat UI (`index.html`) and the staff
  dashboard (`dashboard.html`)
- `backend/` — the Express server: the `/api/chat`, `/api/sms` (Twilio),
  `/api/vonage-sms` (Vonage), and `/api/telnyx-sms` (Telnyx) endpoints,
  order tools, and the orders API used by the dashboard
- `.env.example` — placeholder names for environment variables (no real
  secrets)

## Setup

1. **Install dependencies**

   ```bash
   cd backend
   npm install
   ```

2. **Configure environment variables**

   Copy the example file and fill in a real API key — never commit the
   real file:

   ```bash
   cp ../.env.example ../.env
   ```

   Then edit `.env` at the project root and set:

   | Variable | Required | Description |
   | --- | --- | --- |
   | `AI_API_KEY` | Yes | Your Anthropic API key |
   | `AI_MODEL` | No | Defaults to `claude-opus-5` if unset |
   | `PORT` | No | Defaults to `3000` if unset |
   | `TWILIO_AUTH_TOKEN` | No | Verifies incoming SMS webhooks are really from Twilio (see [SMS Ordering — Twilio](#sms-ordering-twilio) below) |
   | `VONAGE_API_KEY` | No | Your Vonage API key — required to send SMS replies via Vonage |
   | `VONAGE_API_SECRET` | No | Your Vonage API secret |
   | `VONAGE_FROM_NUMBER` | No | Your Vonage virtual number replies are sent from |
   | `VONAGE_WEBHOOK_TOKEN` | No | Shared secret verifying incoming Vonage webhooks (see [SMS Ordering — Vonage](#sms-ordering-vonage) below) |
   | `TELNYX_API_KEY` | No | Your Telnyx API key — required to send SMS replies via Telnyx |
   | `TELNYX_FROM_NUMBER` | No | Your Telnyx number replies are sent from |
   | `TELNYX_WEBHOOK_TOKEN` | No | Shared secret verifying incoming Telnyx webhooks (see [SMS Ordering — Telnyx](#sms-ordering-telnyx) below) |

3. **Run the server**

   ```bash
   npm start
   ```

   This starts a single Express server that serves everything:

   - Customer chat UI: `http://localhost:3000/`
   - Staff dashboard: `http://localhost:3000/dashboard.html`
   - Chat API: `POST http://localhost:3000/api/chat`
   - SMS webhook (Twilio): `POST http://localhost:3000/api/sms`
   - SMS webhook (Vonage): `POST http://localhost:3000/api/vonage-sms`
   - SMS webhook (Telnyx): `POST http://localhost:3000/api/telnyx-sms`
   - Orders API: `GET http://localhost:3000/api/orders`,
     `PATCH http://localhost:3000/api/orders/:orderId/status`

## SMS Ordering (Twilio)

Customers can text the same ordering assistant. It reuses the exact same
menu grounding, order tools, and safety rules as the chat UI — only the
transport is different.

1. Buy or use an existing Twilio phone number with SMS enabled.
2. In the Twilio Console, set that number's **"A message comes in"**
   webhook to `POST` your deployed `/api/sms` URL (e.g.
   `https://your-app.up.railway.app/api/sms`).
3. Set `TWILIO_AUTH_TOKEN` (found on your Twilio Console dashboard) as an
   environment variable on your host. This lets the server verify that
   incoming requests actually came from Twilio, not just anyone who finds
   the URL — the request is rejected with `403` if the signature doesn't
   match. If left unset, requests are accepted unverified (fine for local
   testing only).
4. Text the number — each phone number gets its own conversation and
   order, kept in memory just like a browser chat session, keyed by phone
   number instead of a session ID.

Voice calls are a separate, much larger feature (real-time speech-to-text
and text-to-speech) and are not implemented here.

## SMS Ordering (Vonage)

An alternative to Twilio — same shared order engine and history store,
just a different provider. Unlike Twilio, Vonage can't reply inline in
the webhook response, so replies are sent via a separate outbound API call.

1. In the [Vonage API dashboard](https://dashboard.nexmo.com), create an
   API secret (Settings → API Settings → Create new secret — it can only
   be viewed once, so copy it immediately) and note your API key.
2. Buy an SMS-capable virtual number (Numbers → Buy Number).
3. On that number's settings, set the inbound SMS webhook to `POST` your
   deployed `/api/vonage-sms` URL. If you're using `VONAGE_WEBHOOK_TOKEN`
   (see below), append it as a query string, e.g.
   `https://your-app.up.railway.app/api/vonage-sms?token=YOUR_TOKEN`.
4. Set these environment variables on your host:
   - `VONAGE_API_KEY` and `VONAGE_API_SECRET` — used to send replies.
   - `VONAGE_FROM_NUMBER` — the virtual number replies are sent from.
   - `VONAGE_WEBHOOK_TOKEN` (optional but recommended) — a secret you make
     up yourself, matched against the `?token=` query param on incoming
     requests. Vonage's classic SMS webhook isn't cryptographically
     signed like Twilio's, so this is the lightweight alternative — if
     left unset, incoming requests are accepted unverified.

## SMS Ordering (Telnyx)

A third alternative, same shared order engine and history store. Like
Vonage, Telnyx replies via a separate outbound API call rather than
inline in the webhook response — but its inbound webhook is JSON, not
form-encoded, and it sends several event types (`message.sent`,
`message.received`, `message.finalized`, ...) to the same URL, so the
handler only acts on `message.received`.

1. In the [Telnyx Portal](https://portal.telnyx.com), create an API key
   (API Keys & Tokens) and buy an SMS-capable number (Numbers).
2. On that number's messaging settings, set the inbound webhook to
   `POST` your deployed `/api/telnyx-sms` URL. If you're using
   `TELNYX_WEBHOOK_TOKEN` (see below), append it as a query string, e.g.
   `https://your-app.up.railway.app/api/telnyx-sms?token=YOUR_TOKEN`.
3. Set these environment variables on your host:
   - `TELNYX_API_KEY` — used to send replies.
   - `TELNYX_FROM_NUMBER` — the number replies are sent from.
   - `TELNYX_WEBHOOK_TOKEN` (optional but recommended) — a secret you
     make up yourself, matched against the `?token=` query param, same
     pattern as `VONAGE_WEBHOOK_TOKEN`. If left unset, incoming requests
     are accepted unverified.

## Data & Storage

- Order state during an active conversation is kept **in memory** per
  session and is lost on server restart.
- Confirmed orders are appended to `data/orders.json` — a simple JSON
  file, not a database. Fine for local development and small-scale use;
  it is not safe for concurrent writes at real production scale.
- `data/menu.json` and `data/promotions.json` are the source of truth
  CafeBot is grounded against — edit them directly to change what's for
  sale.

## Deployment

This is a plain Node.js/Express app with no build step, so it deploys to
any Node hosting platform (Railway, Render, Fly.io, a VPS, etc.):

1. Push the repository (a `.gitignore` already excludes `.env` and
   `node_modules/` — confirm no real secrets are staged before your
   first commit).
2. On the host, set the `AI_API_KEY` environment variable (and
   optionally `AI_MODEL`) — never commit these.
3. Set the start command to `npm start` (or `node server.js`) with
   `backend/` as the working directory.
4. The app listens on `process.env.PORT`, so let the platform assign the
   port rather than hardcoding one.

Because order data and session state live on local disk/memory, keep
this on a single instance — it isn't built for multi-instance scaling.
