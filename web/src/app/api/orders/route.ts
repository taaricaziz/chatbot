import { NextResponse } from "next/server";
import { createOrderSchema } from "@/lib/schemas/cart";
import { createOrder, OrderError } from "@/lib/services/orders";
import { clientKey, hit, RULES } from "@/lib/rate-limit";

/**
 * POST /api/orders — creates a CONFIRMED order.
 *
 * A thin wrapper: validation, then the service. Every rule that matters
 * (re-pricing, the confirmation gate, the total-mismatch check, idempotency)
 * lives in services/orders.ts so the AI agent gets them for free.
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
  const limit = hit(clientKey(request, "order"), RULES.createOrder);
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

  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    const confirmIssue = parsed.error.issues.find((i) =>
      i.path.includes("confirmed"),
    );
    return NextResponse.json(
      {
        error: {
          code: confirmIssue ? "NOT_CONFIRMED" : "INVALID_REQUEST",
          message: confirmIssue
            ? "This order has not been confirmed. Nothing was saved."
            : "The order payload is not valid.",
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
    const order = await createOrder({
      ...parsed.data,
      customer: {
        name: parsed.data.customer?.name ?? "",
        phone: parsed.data.customer?.phone ?? "",
        email: parsed.data.customer?.email || undefined,
      },
      idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined,
      source: "WEB",
    });

    return NextResponse.json(order, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "NOT_CONFIRMED" ? 400 : 422 },
      );
    }
    console.error("[orders] unexpected error", error);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Could not place this order." } },
      { status: 500 },
    );
  }
}
