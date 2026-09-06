import { NextResponse } from "next/server";
import { getReservation } from "@/lib/services/reservations";

/** GET /api/reservations/:ref */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const reservation = await getReservation(ref);

  if (!reservation) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No such booking." } },
      { status: 404 },
    );
  }
  return NextResponse.json(reservation, { headers: { "Cache-Control": "no-store" } });
}
