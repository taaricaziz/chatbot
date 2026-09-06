import { NextResponse } from "next/server";
import { drainOutbox } from "@/lib/notifications/dispatch";

/**
 * POST /api/notifications/drain — sends whatever is due.
 *
 * Designed to be called on a schedule (Vercel Cron, or any pinger). It is
 * safe to call as often as you like: messages carry a dedupe key and a
 * backoff, so an extra run sends nothing extra.
 *
 * Protected by a shared secret rather than a staff session, because the
 * caller is a machine. Without NOTIFY_CRON_SECRET set the endpoint refuses
 * outright — an open endpoint that sends messages is an open endpoint that
 * sends messages on somebody else's behalf.
 */
export async function POST(request: Request) {
  const secret = process.env.NOTIFY_CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_CONFIGURED",
          message:
            "NOTIFY_CRON_SECRET is not set, so this endpoint is disabled.",
        },
      },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (provided !== secret) {
    return NextResponse.json(
      { error: { code: "UNAUTHORISED", message: "Bad or missing token." } },
      { status: 401 },
    );
  }

  const result = await drainOutbox();
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
