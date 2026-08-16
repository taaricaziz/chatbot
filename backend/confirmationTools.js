const { persistConfirmedOrder } = require("./orderPersistence");
const { calculateOrderTotals } = require("./orderMath");

// Finite allowlist of clear, unambiguous confirmation phrases (normalized: lowercased,
// trimmed, trailing "." / "!" stripped). Anything not an exact match is treated as
// ambiguous and rejected — safer than a regex that might accidentally match hedged replies.
const CONFIRMATION_PHRASES = new Set([
  "yes",
  "yeah",
  "yea",
  "yep",
  "yup",
  "sure",
  "sure thing",
  "confirm",
  "confirmed",
  "i confirm",
  "confirm it",
  "confirm order",
  "confirm my order",
  "please confirm",
  "yes confirm",
  "correct",
  "that's correct",
  "thats correct",
  "that is correct",
  "yes that's correct",
  "yes thats correct",
  "yes correct",
  "that's right",
  "thats right",
  "yes that's right",
  "yes thats right",
  "sounds good",
  "looks good",
  "looks right",
  "perfect",
  "go ahead",
  "please proceed",
  "proceed",
  "please go ahead",
  "place my order",
  "place the order",
  "place order",
  "yes place my order",
  "yes place the order",
  "do it",
  "yes please",
  "affirmative",
]);

function normalizeReply(reply) {
  // Note: "?" is deliberately left in place, so a question never collapses into a match.
  return reply
    .toLowerCase()
    .replace(/[.,!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExplicitConfirmation(reply) {
  if (typeof reply !== "string") return false;
  return CONFIRMATION_PHRASES.has(normalizeReply(reply));
}

const confirmOrderTool = {
  name: "confirm_order",
  description:
    "Finalize the order for saving. Only call this after you have shown the customer the final order review (via get_final_order_review) and they reply with a clear, unambiguous confirmation such as \"yes\", \"confirm\", or \"place my order\". Pass the customer's exact reply as customerReply — it is validated in code, and anything that isn't a clear confirmation (e.g. \"maybe\", \"I think so\", a question, or a correction) will be rejected. Never call this speculatively, and never treat an ambiguous reply as confirmation.",
  input_schema: {
    type: "object",
    properties: {
      customerReply: {
        type: "string",
        description: "The customer's exact reply after seeing the final order review, verbatim.",
      },
    },
    required: ["customerReply"],
  },
};

function executeConfirmOrder(order, input) {
  const { customerReply } = input || {};

  if (order.confirmed) {
    return { isError: true, content: "This order has already been confirmed." };
  }
  if (!order.items.length) {
    return { isError: true, content: "The order is empty — there is nothing to confirm." };
  }
  if (!order.orderType) {
    return { isError: true, content: "No fulfillment method has been selected yet (pickup or delivery)." };
  }
  if (order.orderType === "delivery" && !order.customer.addressConfirmed) {
    return {
      isError: true,
      content: "The delivery address has not been confirmed yet. Confirm the address before finalizing the order.",
    };
  }
  if (!isExplicitConfirmation(customerReply)) {
    return {
      isError: true,
      content: `"${customerReply}" is not a clear, unambiguous confirmation. Ask the customer to explicitly confirm (e.g. "yes" or "confirm my order") or fix whatever they're unsure about — do not treat this reply as confirmation.`,
    };
  }

  order.confirmed = true;
  order.status = "confirmed";
  // Compute fresh here rather than trusting order.total — the caller's tool loop only
  // recomputes it once at the very end of a turn, which could be after this point.
  order.total = calculateOrderTotals(order).total;

  const record = persistConfirmedOrder(order);
  order.orderId = record.orderId;

  return {
    isError: false,
    content: `Order confirmed and saved. Order number: ${record.orderId}.`,
  };
}

module.exports = { isExplicitConfirmation, confirmOrderTool, executeConfirmOrder };
