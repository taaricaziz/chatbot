const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ORDERS_PATH = path.resolve(__dirname, "..", "data", "orders.json");

function generateOrderId() {
  return `CB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function loadOrders() {
  if (!fs.existsSync(ORDERS_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(ORDERS_PATH, "utf8").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_PATH, `${JSON.stringify(orders, null, 2)}\n`, "utf8");
}

// Persists a CONFIRMED order only. This is the sole function that writes to
// data/orders.json — callers must guarantee order.confirmed === true before
// calling it. Drafts must never reach disk, so this refuses to write one.
function persistConfirmedOrder(order) {
  if (!order.confirmed) {
    throw new Error("Refusing to persist an unconfirmed (draft) order.");
  }

  const record = {
    orderId: generateOrderId(),
    createdAt: new Date().toISOString(),
    status: "NEW",
    orderType: order.orderType,
    items: order.items,
    customer: order.customer,
    promotion: order.promotion,
    total: order.total,
  };

  const orders = loadOrders();
  orders.push(record);
  saveOrders(orders);

  return record;
}

const STATUS_OPTIONS = ["NEW", "PREPARING", "READY", "COMPLETED"];

function updateOrderStatus(orderId, newStatus) {
  if (!STATUS_OPTIONS.includes(newStatus)) {
    return {
      ok: false,
      httpStatus: 400,
      error: `Invalid status "${newStatus}". Must be one of: ${STATUS_OPTIONS.join(", ")}.`,
    };
  }

  const orders = loadOrders();
  const order = orders.find((o) => o.orderId === orderId);
  if (!order) {
    return { ok: false, httpStatus: 404, error: `No order with id "${orderId}" exists.` };
  }

  order.status = newStatus;
  saveOrders(orders);

  return { ok: true, order };
}

module.exports = { persistConfirmedOrder, loadOrders, updateOrderStatus, STATUS_OPTIONS };
