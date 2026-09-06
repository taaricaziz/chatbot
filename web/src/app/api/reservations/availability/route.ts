import { NextResponse } from "next/server";
import { availabilityQuerySchema } from "@/lib/schemas/cart";
import { getAvailability, ReservationError } from "@/lib/services/reservations";
import { clientKey, hit, RULES } from "@/lib/rate-limit";

/** GET /api/reservations/availability?date=&partySize=&seating= */
function tooMany(result: { retryAfterSeconds: number; limit: number }) {
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "That's a lot of requests. Give it a moment and try again.",
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
      },
    },
  );
}

export async function GET(request: Request) {
  // Unauthenticated and database-heavy — the obvious endpoint to scrape.
  const limit = hit(clientKey(request, "availability"), RULES.availability);
  if (!limit.allowed) return tooMany(limit);

  const url = new URL(request.url);
  const parsed = availabilityQuerySchema.safeParse({
    date: url.searchParams.get("date"),
    partySize: url.searchParams.get("partySize"),
    seating: url.searchParams.get("seating") ?? "ANY",
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "That availability query is not valid.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await getAvailability(parsed.data);
    return NextResponse.json(result, {
      // Availability changes the moment anyone books. Never cache it.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ReservationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 422 },
      );
    }
    console.error("[reservations/availability] unexpected", error);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Could not check availability." } },
      { status: 500 },
    );
  }
}
