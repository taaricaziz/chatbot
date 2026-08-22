require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const { getOrderState } = require("./orderState");
const { getSmsHistory } = require("./smsSessions");
const {
  addItemToOrderTool,
  executeAddItemToOrder,
  modifyOrderItemTool,
  executeModifyOrderItem,
  removeOrderItemTool,
  executeRemoveOrderItem,
  getOrderSummaryTool,
  executeGetOrderSummary,
  getOrderTotalTool,
  executeGetOrderTotal,
  getFinalOrderReviewTool,
  executeGetFinalOrderReview,
} = require("./orderTools");
const { calculateOrderTotals } = require("./orderMath");
const { recommendItemsTool, executeRecommendItems } = require("./recommendationTools");
const {
  listEligiblePromotionsTool,
  executeListEligiblePromotions,
  applyPromotionTool,
  executeApplyPromotion,
} = require("./promotionTools");
const {
  setPickupDetailsTool,
  executeSetPickupDetails,
  setDeliveryDetailsTool,
  executeSetDeliveryDetails,
  confirmDeliveryAddressTool,
  executeConfirmDeliveryAddress,
} = require("./fulfillmentTools");
const { confirmOrderTool, executeConfirmOrder } = require("./confirmationTools");
const { loadOrders, updateOrderStatus } = require("./orderPersistence");

const TOOLS = [
  addItemToOrderTool,
  modifyOrderItemTool,
  removeOrderItemTool,
  getOrderSummaryTool,
  getOrderTotalTool,
  getFinalOrderReviewTool,
  recommendItemsTool,
  listEligiblePromotionsTool,
  applyPromotionTool,
  setPickupDetailsTool,
  setDeliveryDetailsTool,
  confirmDeliveryAddressTool,
  confirmOrderTool,
];
const MAX_TOOL_ITERATIONS = 5;

function runTool(order, block) {
  if (block.name === "add_item_to_order") {
    return executeAddItemToOrder(order, block.input);
  }
  if (block.name === "modify_order_item") {
    return executeModifyOrderItem(order, block.input);
  }
  if (block.name === "remove_order_item") {
    return executeRemoveOrderItem(order, block.input);
  }
  if (block.name === "get_order_summary") {
    return executeGetOrderSummary(order);
  }
  if (block.name === "get_order_total") {
    return executeGetOrderTotal(order);
  }
  if (block.name === "get_final_order_review") {
    return executeGetFinalOrderReview(order);
  }
  if (block.name === "recommend_items") {
    return executeRecommendItems(block.input);
  }
  if (block.name === "list_eligible_promotions") {
    return executeListEligiblePromotions(order);
  }
  if (block.name === "apply_promotion") {
    return executeApplyPromotion(order, block.input);
  }
  if (block.name === "set_pickup_details") {
    return executeSetPickupDetails(order, block.input);
  }
  if (block.name === "set_delivery_details") {
    return executeSetDeliveryDetails(order, block.input);
  }
  if (block.name === "confirm_delivery_address") {
    return executeConfirmDeliveryAddress(order, block.input);
  }
  if (block.name === "confirm_order") {
    return executeConfirmOrder(order, block.input);
  }
  return { isError: true, content: `Unknown tool "${block.name}".` };
}

if (!process.env.AI_API_KEY) {
  console.warn("Warning: AI_API_KEY is not set. Copy .env.example to .env and add your key.");
}

const anthropic = new Anthropic({ apiKey: process.env.AI_API_KEY });
const MODEL = process.env.AI_MODEL || "claude-opus-5";
const SYSTEM_PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "system-prompt.md");
const MENU_PATH = path.resolve(__dirname, "..", "data", "menu.json");
const PROMOTIONS_PATH = path.resolve(__dirname, "..", "data", "promotions.json");

function buildSystemPrompt() {
  const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf8");
  const menu = fs.readFileSync(MENU_PATH, "utf8");
  const promotions = fs.readFileSync(PROMOTIONS_PATH, "utf8");

  return [
    systemPrompt,
    "## Menu Data (data/menu.json — the only source of truth for the menu)",
    "Use ONLY the items, prices, sizes, options, allergens, dietary info, and availability listed below. Never invent an item, price, or detail that isn't present here.",
    "```json",
    menu,
    "```",
    "## Promotions Data (data/promotions.json — the only source of truth for discounts)",
    "Only mention, recommend, or apply a promotion when its \"active\" field is true and its eligibility is actually met. Use the list_eligible_promotions and apply_promotion tools to check and apply promotions — never do the eligibility math yourself. Never invent a discount, coupon, or promotion that isn't listed below.",
    "```json",
    promotions,
    "```",
  ].join("\n\n");
}

const FRONTEND_PATH = path.resolve(__dirname, "..", "frontend");

const app = express();
app.set("trust proxy", true); // needed so req.protocol is correct behind Railway's/Vercel's proxy, for Twilio signature checks
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio webhooks post form-encoded bodies
app.use(express.static(FRONTEND_PATH));

app.get("/api/orders", (req, res) => {
  try {
    res.json({ orders: loadOrders() });
  } catch (err) {
    console.error("Failed to load orders:", err.message);
    res.status(500).json({ error: "Failed to load orders." });
  }
});

app.patch("/api/orders/:orderId/status", (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body || {};

  if (typeof status !== "string" || !status.trim()) {
    return res.status(400).json({ error: "status is required" });
  }

  const result = updateOrderStatus(orderId, status);
  if (!result.ok) {
    return res.status(result.httpStatus).json({ error: result.error });
  }

  res.json({ order: result.order });
});

async function getChatReply(order, message, history) {
  const messages = [...(history || []), { role: "user", content: message }];
  const system = buildSystemPrompt();

  let response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: TOOLS,
    messages,
  });

  let iterations = 0;
  while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;
    messages.push({ role: "assistant", content: response.content });

    const toolResults = response.content
      .filter((block) => block.type === "tool_use")
      .map((block) => {
        const result = runTool(order, block);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        };
      });

    messages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages,
    });
  }

  order.total = calculateOrderTotals(order).total;

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock ? textBlock.text : "Sorry, I'm having trouble completing that — could you try again?";
}

app.post("/api/chat", async (req, res) => {
  const { message, history, sessionId: incomingSessionId } = req.body || {};

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ error: "history must be an array" });
  }

  const sessionId =
    typeof incomingSessionId === "string" && incomingSessionId ? incomingSessionId : crypto.randomUUID();
  const order = getOrderState(sessionId);

  try {
    const reply = await getChatReply(order, message, history);
    res.json({ reply, sessionId, order });
  } catch (err) {
    console.error("CafeBot chat request failed:", err.message);
    res.status(502).json({ error: "Failed to get a response from the AI service." });
  }
});

app.post("/api/sms", async (req, res) => {
  if (process.env.TWILIO_AUTH_TOKEN) {
    const signature = req.headers["x-twilio-signature"];
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const isValid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body);
    if (!isValid) {
      return res.status(403).send("Invalid Twilio signature.");
    }
  } else {
    console.warn("Warning: TWILIO_AUTH_TOKEN is not set — incoming SMS requests are not verified.");
  }

  const from = req.body.From;
  const body = req.body.Body;
  const twiml = new twilio.twiml.MessagingResponse();

  if (typeof from !== "string" || !from || typeof body !== "string" || !body.trim()) {
    twiml.message("Sorry, I didn't get that. Please try texting again.");
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const order = getOrderState(from);
  const history = getSmsHistory(from);

  try {
    const reply = await getChatReply(order, body, history);
    history.push({ role: "user", content: body });
    history.push({ role: "assistant", content: reply });

    twiml.message(reply.replace(/\*\*/g, ""));
    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("CafeBot SMS request failed:", err.message);
    twiml.message("Sorry, I'm having trouble right now. Please try again in a moment.");
    res.type("text/xml").send(twiml.toString());
  }
});

// Vonage doesn't support replying inline in the webhook response (unlike Twilio's TwiML),
// so we acknowledge immediately and send the reply back via a separate outbound API call.
async function sendVonageSms(to, text) {
  const params = new URLSearchParams({
    api_key: process.env.VONAGE_API_KEY,
    api_secret: process.env.VONAGE_API_SECRET,
    from: process.env.VONAGE_FROM_NUMBER,
    to,
    text,
  });

  const res = await fetch("https://rest.nexmo.com/sms/json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = await res.json();
  const failedMessage = (data.messages || []).find((m) => m.status !== "0");
  if (failedMessage) {
    console.error("Vonage SMS send failed:", failedMessage["error-text"] || JSON.stringify(failedMessage));
  }
}

app.post("/api/vonage-sms", async (req, res) => {
  if (process.env.VONAGE_WEBHOOK_TOKEN) {
    if (req.query.token !== process.env.VONAGE_WEBHOOK_TOKEN) {
      return res.status(403).send("Invalid webhook token.");
    }
  } else {
    console.warn("Warning: VONAGE_WEBHOOK_TOKEN is not set — incoming Vonage SMS requests are not verified.");
  }

  const from = req.body.msisdn;
  const body = req.body.text;
  res.sendStatus(200); // acknowledge immediately; Vonage ignores the response body

  if (typeof from !== "string" || !from || typeof body !== "string" || !body.trim()) {
    return;
  }

  const order = getOrderState(from);
  const history = getSmsHistory(from);

  try {
    const reply = await getChatReply(order, body, history);
    history.push({ role: "user", content: body });
    history.push({ role: "assistant", content: reply });
    await sendVonageSms(from, reply.replace(/\*\*/g, ""));
  } catch (err) {
    console.error("CafeBot Vonage SMS request failed:", err.message);
    await sendVonageSms(from, "Sorry, I'm having trouble right now. Please try again in a moment.").catch(
      () => {}
    );
  }
});

// Telnyx also replies via a separate outbound API call rather than inline in the webhook response,
// and sends inbound webhooks as JSON (not form-encoded like Twilio/Vonage).
async function sendTelnyxSms(to, text) {
  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.TELNYX_FROM_NUMBER,
      to,
      text,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error("Telnyx SMS send failed:", JSON.stringify(data.errors || data));
  }
}

app.post("/api/telnyx-sms", async (req, res) => {
  if (process.env.TELNYX_WEBHOOK_TOKEN) {
    if (req.query.token !== process.env.TELNYX_WEBHOOK_TOKEN) {
      return res.status(403).send("Invalid webhook token.");
    }
  } else {
    console.warn("Warning: TELNYX_WEBHOOK_TOKEN is not set — incoming Telnyx SMS requests are not verified.");
  }

  const event = req.body && req.body.data;
  res.sendStatus(200); // acknowledge immediately; Telnyx ignores the response body

  // Telnyx sends multiple event types (message.sent, message.finalized, etc.) to the same
  // webhook — only reply to actually-received inbound messages.
  if (!event || event.event_type !== "message.received") {
    return;
  }

  const payload = event.payload || {};
  const from = payload.from && payload.from.phone_number;
  const body = payload.text;

  if (typeof from !== "string" || !from || typeof body !== "string" || !body.trim()) {
    return;
  }

  const order = getOrderState(from);
  const history = getSmsHistory(from);

  try {
    const reply = await getChatReply(order, body, history);
    history.push({ role: "user", content: body });
    history.push({ role: "assistant", content: reply });
    await sendTelnyxSms(from, reply.replace(/\*\*/g, ""));
  } catch (err) {
    console.error("CafeBot Telnyx SMS request failed:", err.message);
    await sendTelnyxSms(from, "Sorry, I'm having trouble right now. Please try again in a moment.").catch(
      () => {}
    );
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CafeBot backend listening on port ${PORT}`);
  });
}

module.exports = app;
