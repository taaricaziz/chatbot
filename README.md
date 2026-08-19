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
- `backend/` — the Express server: the `/api/chat` and `/api/sms`
  endpoints, order tools, and the orders API used by the dashboard
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
   | `TWILIO_AUTH_TOKEN` | No | Verifies incoming SMS webhooks are really from Twilio (see [SMS Ordering](#sms-ordering-twilio) below) |

3. **Run the server**

   ```bash
   npm start
   ```

   This starts a single Express server that serves everything:

   - Customer chat UI: `http://localhost:3000/`
   - Staff dashboard: `http://localhost:3000/dashboard.html`
   - Chat API: `POST http://localhost:3000/api/chat`
   - SMS webhook: `POST http://localhost:3000/api/sms`
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
