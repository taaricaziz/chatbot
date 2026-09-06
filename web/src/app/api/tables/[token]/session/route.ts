import { NextResponse } from "next/server";
import { SessionError, startSession } from "@/lib/services/table-sessions";

/**
 * POST /api/tables/:token/session
 *
 * Opens a session for the table, or joins the one already open — a second
 * phone at the same table must land on the SAME bill, not start a rival one.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const { session, tableLabel } = await startSession(token);
    return NextResponse.json(
      { sessionId: session.id, tableLabel, status: session.status, openedAt: session.openedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "UNKNOWN_TABLE" ? 404 : 409 },
      );
    }
    console.error("[tables/session] unexpected", error);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Could not open a table session." } },
      { status: 500 },
    );
  }
}
