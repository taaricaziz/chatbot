import { NextResponse } from "next/server";
import { quoteRequestSchema } from "@/lib/schemas/cart";
import { CartError, quoteCart } from "@/lib/services/cart";
import { clientKey, hit, RULES } from "@/lib/rate-limit";

/**
 * POST /api/cart/quote — prices a cart without saving anything.
 *
 * A thin validation-and-serialisation wrapper over the cart service. All the
 * arithmetic lives in services/pricing.ts; nothing is computed here.
 *
 * This is the endpoint both the checkout UI and the AI agent call, which is
 * what keeps them from ever disagreeing about a total.
 */
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
  const limit = hit(clientKey(request, "quote"), RULES.quote);
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

  const parsed = quoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "The cart payload is not valid.",
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
    const quote = await quoteCart(parsed.data);
    return NextResponse.json(quote, {
      // A quote reflects live prices and availability; never cache it.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof CartError) {
      return NextResponse.json(
        { error: { code: "CART_ERROR", message: error.message } },
        { status: 422 },
      );
    }
    console.error("[cart/quote] unexpected error", error);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Could not price this cart." } },
      { status: 500 },
    );
  }
}
