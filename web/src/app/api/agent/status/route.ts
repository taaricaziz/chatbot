import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { agentEnabled, rolloutPercent } from "@/lib/agent-config";
import { bucketFor, isInRollout, newVisitorToken } from "@/lib/services/rollout";

/**
 * GET /api/agent/status — should this visitor be shown the assistant?
 *
 * This endpoint exists because of a real defect: marketing routes are
 * statically rendered, so a gate evaluated in a Server Component is baked in
 * at BUILD time. Switching the assistant off would have left the widget on
 * the page, erroring, until the next deploy — the opposite of a kill switch.
 *
 * Deciding here keeps those pages static (the performance budget depends on
 * it) while making the switch take effect on the very next request.
 */
export const dynamic = "force-dynamic";

/** Opaque, and not personal data: a random value that identifies nobody. */
const COOKIE = "gootee_visitor";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function GET() {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  const token = existing ?? newVisitorToken();

  const enabled = agentEnabled();
  const visible = enabled && isInRollout(bucketFor(token), rolloutPercent());

  const response = NextResponse.json(
    { visible },
    { headers: { "Cache-Control": "no-store" } },
  );

  if (!existing) {
    // Set so the same visitor keeps the same answer as they browse — an
    // assistant that appears and disappears between pages reads as broken.
    response.cookies.set(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_YEAR,
    });
  }

  return response;
}
