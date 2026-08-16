// In-memory, session-based order state. No database — state is lost on server restart.
const orders = new Map();

function createOrderState() {
  return {
    items: [], // [{ id, name, quantity, size, options: { milk: "Oat Milk", ... }, unitPrice }]
    orderType: null, // "pickup" | "delivery" | null
    customer: {
      name: null,
      phone: null,
      address: null,
      apartment: null,
      deliveryInstructions: null,
      addressConfirmed: false, // must be explicitly confirmed by the customer before delivery checkout
      pickupTime: null,
    },
    promotion: null, // applied promotion id, or null
    total: 0,
    confirmed: false,
    status: "draft", // "draft" | "confirmed"
    orderId: null, // set once persisted to data/orders.json after confirmation
  };
}

function getOrderState(sessionId) {
  if (!orders.has(sessionId)) {
    orders.set(sessionId, createOrderState());
  }
  return orders.get(sessionId);
}

module.exports = { createOrderState, getOrderState };
