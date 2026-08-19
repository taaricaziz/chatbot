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
- `backend/` — the Express server: the `/api/chat` endpoint, order
  tools, and the orders API used by the dashboard
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

3. **Run the server**

   ```bash
   npm start
   ```

   This starts a single Express server that serves everything:

   - Customer chat UI: `http://localhost:3000/`
   - Staff dashboard: `http://localhost:3000/dashboard.html`
   - Chat API: `POST http://localhost:3000/api/chat`
   - Orders API: `GET http://localhost:3000/api/orders`,
     `PATCH http://localhost:3000/api/orders/:orderId/status`

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
