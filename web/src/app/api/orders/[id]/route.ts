import { NextResponse } from "next/server";
import { getOrder } from "@/lib/services/orders";

/** GET /api/orders/:id — by opaque id or order number. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const order = await getOrder(id);

  if (!order) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No such order." } },
      { status: 404 },
    );
  }

  return NextResponse.json(order, {
    headers: { "Cache-Control": "no-store" },
  });
}
