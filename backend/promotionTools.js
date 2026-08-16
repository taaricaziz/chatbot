const { findMenuItem } = require("./menu");
const { loadPromotions, findPromotion } = require("./promotions");

function calculateSubtotal(order) {
  return order.items.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

function isEligible(promotion, order) {
  const eligibility = promotion.eligibility || {};

  if (eligibility.minSubtotal !== undefined) {
    if (calculateSubtotal(order) < eligibility.minSubtotal) return false;
  }

  if (eligibility.requiresCategory) {
    const hasMatch = order.items.some((line) => {
      const menuItem = findMenuItem(line.id);
      if (!menuItem || menuItem.category !== eligibility.requiresCategory) return false;
      if (eligibility.requiresSize && line.size !== eligibility.requiresSize) return false;
      return true;
    });
    if (!hasMatch) return false;
  }

  return true;
}

const listEligiblePromotionsTool = {
  name: "list_eligible_promotions",
  description:
    "List active promotions that the customer's current order actually qualifies for right now. Call this before mentioning or suggesting any promotion or discount — never state a promotion that isn't in this list, and never mention an inactive promotion.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

function executeListEligiblePromotions(order) {
  const { promotions } = loadPromotions();
  const eligible = promotions.filter((p) => p.active && isEligible(p, order));

  if (!eligible.length) {
    return { isError: false, content: "No promotions are currently eligible for this order." };
  }

  const summary = eligible.map((p) => `${p.name} (id: ${p.id}) — ${p.rule}`).join("; ");
  return { isError: false, content: `Eligible promotions: ${summary}` };
}

const applyPromotionTool = {
  name: "apply_promotion",
  description:
    "Apply an active, eligible promotion to the customer's order. Only call this with a real promotion id from the promotions data (check list_eligible_promotions first). Never apply an inactive promotion or invent a discount.",
  input_schema: {
    type: "object",
    properties: {
      promotionId: {
        type: "string",
        description: "The promotion's id from the promotions data, e.g. \"promo-01\".",
      },
    },
    required: ["promotionId"],
  },
};

function executeApplyPromotion(order, input) {
  const { promotionId } = input || {};
  if (!promotionId) {
    return { isError: true, content: "promotionId is required." };
  }

  const promotion = findPromotion(promotionId);
  if (!promotion) {
    return { isError: true, content: `No promotion with id "${promotionId}" exists.` };
  }
  if (!promotion.active) {
    return { isError: true, content: `"${promotion.name}" is not currently active and cannot be applied.` };
  }
  if (!isEligible(promotion, order)) {
    return {
      isError: true,
      content: `The order does not meet the eligibility rule for "${promotion.name}": ${promotion.rule}`,
    };
  }

  order.promotion = {
    id: promotion.id,
    name: promotion.name,
    rule: promotion.rule,
    discount: promotion.discount,
  };

  return { isError: false, content: `Applied promotion "${promotion.name}" (${promotion.rule}).` };
}

module.exports = {
  isEligible,
  listEligiblePromotionsTool,
  executeListEligiblePromotions,
  applyPromotionTool,
  executeApplyPromotion,
};
