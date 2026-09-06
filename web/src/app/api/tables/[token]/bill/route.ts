import { NextResponse } from "next/server";
import { getSessionBill, SessionError } from "@/lib/services/table-sessions";

/** GET /api/tables/:token/bill — the running total across every round. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const bill = await getSessionBill(token);
    return NextResponse.json(bill, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 404 },
      );
    }
    console.error("[tables/bill] unexpected", error);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Could not load the bill." } },
      { status: 500 },
    );
  }
}
