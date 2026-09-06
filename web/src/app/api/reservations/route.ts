import { NextResponse } from "next/server";
import { createReservationSchema } from "@/lib/schemas/cart";
import { createReservation, ReservationError } from "@/lib/services/reservations";
import { clientKey, hit, RULES } from "@/lib/rate-limit";

/** POST /api/reservations — books a table. */
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

export async function POST(request: Request) {
  // Rate limit BEFORE parsing the body: a flood should cost as little as
  // possible to reject.
  const limit = hit(clientKey(request, "reservation"), RULES.createReservation);
  if (!limit.allowed) return tooMany(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be JSON." } },
      { status: 400 },
    );
  }

  const parsed = createReservationSchema.safeParse(body);
  if (!parsed.success) {
    const unconfirmed = parsed.error.issues.some((i) => i.path.includes("confirmed"));
    return NextResponse.json(
      {
        error: {
          code: unconfirmed ? "NOT_CONFIRMED" : "INVALID_REQUEST",
          message: unconfirmed
            ? "This booking has not been confirmed. Nothing was saved."
            : "The booking details are not valid.",
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
    const reservation = await createReservation({
      ...parsed.data,
      email: parsed.data.email || undefined,
    });
    return NextResponse.json(reservation, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ReservationError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            // Never leave a guest at a dead end: if the slot went, offer the
            // nearest times that are still free.
            alternatives: error.alternatives,
          },
        },
        { status: error.code === "NOT_CONFIRMED" ? 400 : 409 },
      );
    }
    console.error("[reservations] unexpected", error);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Could not make that booking." } },
      { status: 500 },
    );
  }
}
