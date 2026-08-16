const { findMenuItem } = require("./menu");
const { findPromotion } = require("./promotions");

// Simple, flat configuration — no per-item or per-zone rules.
const TAX_RATE = 0.08; // 8% flat sales tax
const DELIVERY_FEE = 3.0; // flat fee, applied only to delivery orders

function round2(amount) {
  return Math.round(amount * 100) / 100;
}

function calculateSubtotal(order) {
  return order.items.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

function calculateDiscount(order) {
  if (!order.promotion) return 0;

  const promotion = findPromotion(order.promotion.id);
  if (!promotion || !promotion.active || !promotion.discount) return 0;

  const { type, value } = promotion.discount;

  if (type === "percentage") {
    return calculateSubtotal(order) * (value / 100);
  }

  if (type === "free_item" && value === "cheapest_item_in_free_category") {
    const freeItemCategory = promotion.eligibility && promotion.eligibility.freeItemCategory;
    if (!freeItemCategory) return 0;

    const candidates = order.items
      .map((line) => ({ line, menuItem: findMenuItem(line.id) }))
      .filter(({ menuItem }) => menuItem && menuItem.category === freeItemCategory);

    if (!candidates.length) return 0;

    const cheapest = candidates.reduce((min, c) => (c.line.unitPrice < min.line.unitPrice ? c : min));
    return cheapest.line.unitPrice;
  }

  return 0;
}

function calculateOrderTotals(order) {
  const subtotal = calculateSubtotal(order);
  const discount = calculateDiscount(order);
  const taxableAmount = Math.max(0, subtotal - discount);
  const tax = taxableAmount * TAX_RATE;
  const deliveryFee = order.orderType === "delivery" ? DELIVERY_FEE : 0;
  const total = taxableAmount + tax + deliveryFee;

  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    tax: round2(tax),
    deliveryFee: round2(deliveryFee),
    total: round2(total),
  };
}

module.exports = { TAX_RATE, DELIVERY_FEE, calculateSubtotal, calculateOrderTotals };
