const { findMenuItem } = require("./menu");
const { calculateOrderTotals } = require("./orderMath");
const { findPromotion } = require("./promotions");
const { isEligible } = require("./promotionTools");

const addItemToOrderTool = {
  name: "add_item_to_order",
  description:
    "Add a valid menu item to the customer's current order. Only call this once you know every required option the menu data lists for the item (such as size or milk) — if something required is still missing, ask the customer instead of calling this tool.",
  input_schema: {
    type: "object",
    properties: {
      itemId: {
        type: "string",
        description: "The menu item's id from the menu data, e.g. \"lat-01\".",
      },
      quantity: {
        type: "integer",
        description: "How many of this item to add. Must be a positive whole number.",
        minimum: 1,
      },
      size: {
        type: "string",
        description:
          "The chosen size name, exactly as it appears in the item's sizes list. Only needed when the item has more than one size option.",
      },
      options: {
        type: "object",
        description:
          "Chosen values for the item's options (e.g. {\"milk\": \"Oat Milk\"}), matching the option names and choices in the menu data.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["itemId", "quantity"],
  },
};

function executeAddItemToOrder(order, input) {
  const { itemId, quantity, size, options: requestedOptions } = input || {};

  const item = findMenuItem(itemId);
  if (!item) {
    return { isError: true, content: `No menu item with id "${itemId}" exists. Only use items from the menu data.` };
  }
  if (!item.available) {
    return { isError: true, content: `"${item.name}" is currently unavailable and cannot be added to the order.` };
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { isError: true, content: "quantity must be a positive whole number." };
  }

  let chosenSize;
  if (item.sizes.length > 1) {
    chosenSize = item.sizes.find((s) => s.name === size);
    if (!chosenSize) {
      const choices = item.sizes.map((s) => s.name).join(", ");
      return { isError: true, content: `"${item.name}" requires a size. Ask the customer to choose one of: ${choices}.` };
    }
  } else {
    chosenSize = item.sizes[0];
  }

  const chosenOptions = {};
  for (const [optionName, choices] of Object.entries(item.options || {})) {
    if (choices.length <= 1) {
      chosenOptions[optionName] = choices[0];
      continue;
    }
    const chosen = requestedOptions && requestedOptions[optionName];
    if (!chosen || !choices.includes(chosen)) {
      return {
        isError: true,
        content: `"${item.name}" requires a choice for "${optionName}". Ask the customer to choose one of: ${choices.join(", ")}.`,
      };
    }
    chosenOptions[optionName] = chosen;
  }

  const unitPrice = item.price + (chosenSize.priceModifier || 0);

  order.items.push({
    id: item.id,
    name: item.name,
    quantity,
    size: chosenSize.name,
    options: chosenOptions,
    unitPrice,
  });

  const optionsSummary = Object.values(chosenOptions).join(", ");
  const summary = `Added ${quantity}x ${chosenSize.name} ${item.name}${optionsSummary ? ` (${optionsSummary})` : ""} to the order.`;

  return { isError: false, content: summary };
}

const modifyOrderItemTool = {
  name: "modify_order_item",
  description:
    "Change the quantity, size, or customizations (e.g. milk) of an item already in the customer's current order. Identify the item by its menu id; if the order has more than one line for that item, also pass currentSize to say which one. Provide at least one of newQuantity, newSize, or newOptions.",
  input_schema: {
    type: "object",
    properties: {
      itemId: {
        type: "string",
        description: "The menu item's id, matching an item already in the order.",
      },
      currentSize: {
        type: "string",
        description:
          "The item's current size, used to identify which order line to modify when there is more than one line for this item.",
      },
      newQuantity: {
        type: "integer",
        description: "New quantity for the item. Must be a positive whole number.",
        minimum: 1,
      },
      newSize: {
        type: "string",
        description: "New size name, exactly as it appears in the menu data's sizes list for this item.",
      },
      newOptions: {
        type: "object",
        description:
          "Option changes to apply, e.g. {\"milk\": \"Almond Milk\"}. Only the keys provided are changed; other existing options are kept.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["itemId"],
  },
};

function executeModifyOrderItem(order, input) {
  const { itemId, currentSize, newQuantity, newSize, newOptions } = input || {};

  if (!itemId) {
    return { isError: true, content: "itemId is required to identify which order item to modify." };
  }
  if (newQuantity === undefined && newSize === undefined && !newOptions) {
    return { isError: true, content: "Specify at least one change: newQuantity, newSize, or newOptions." };
  }

  const item = findMenuItem(itemId);
  if (!item) {
    return { isError: true, content: `No menu item with id "${itemId}" exists.` };
  }

  let matches = order.items.filter((line) => line.id === itemId);
  if (matches.length === 0) {
    return { isError: true, content: `There is no "${item.name}" in the current order to modify.` };
  }
  if (matches.length > 1 && currentSize) {
    matches = matches.filter((line) => line.size === currentSize);
    if (matches.length === 0) {
      return { isError: true, content: `No "${item.name}" with size "${currentSize}" was found in the order.` };
    }
  }
  if (matches.length > 1) {
    const descriptions = matches
      .map((line) => {
        const optionsSummary = Object.values(line.options || {}).join(", ");
        return `${line.size}${optionsSummary ? ` (${optionsSummary})` : ""}`;
      })
      .join("; ");
    return {
      isError: true,
      content: `There are multiple "${item.name}" items in the order (${descriptions}). Pass currentSize to say which one to modify.`,
    };
  }

  const target = matches[0];

  if (newQuantity !== undefined && (!Number.isInteger(newQuantity) || newQuantity < 1)) {
    return { isError: true, content: "newQuantity must be a positive whole number." };
  }

  let finalSizeName = target.size;
  if (newSize !== undefined) {
    const matchedSize = item.sizes.find((s) => s.name === newSize);
    if (!matchedSize) {
      const choices = item.sizes.map((s) => s.name).join(", ");
      return { isError: true, content: `"${item.name}" doesn't have a size called "${newSize}". Valid sizes: ${choices}.` };
    }
    finalSizeName = matchedSize.name;
  }

  const finalOptions = { ...target.options };
  if (newOptions) {
    for (const [optionName, value] of Object.entries(newOptions)) {
      const choices = (item.options || {})[optionName];
      if (!choices) {
        return { isError: true, content: `"${item.name}" has no option called "${optionName}".` };
      }
      if (!choices.includes(value)) {
        return { isError: true, content: `"${optionName}" for "${item.name}" must be one of: ${choices.join(", ")}.` };
      }
      finalOptions[optionName] = value;
    }
  }

  const finalSizeObj = item.sizes.find((s) => s.name === finalSizeName);

  target.quantity = newQuantity !== undefined ? newQuantity : target.quantity;
  target.size = finalSizeName;
  target.options = finalOptions;
  target.unitPrice = item.price + (finalSizeObj.priceModifier || 0);

  const optionsSummary = Object.values(finalOptions).join(", ");
  const summary = `Updated your order: ${target.quantity}x ${finalSizeName} ${item.name}${optionsSummary ? ` (${optionsSummary})` : ""}.`;

  return { isError: false, content: summary };
}

const removeOrderItemTool = {
  name: "remove_order_item",
  description:
    "Remove an item from the customer's current order, or reduce its quantity. Identify the item by its menu id; if the order has more than one line for that item, also pass currentSize to say which one. Omit quantityToRemove to remove the entire line; pass a specific quantityToRemove to reduce it by that amount instead (the line is removed entirely if that brings its quantity to zero or below).",
  input_schema: {
    type: "object",
    properties: {
      itemId: {
        type: "string",
        description: "The menu item's id, matching an item already in the order.",
      },
      currentSize: {
        type: "string",
        description:
          "The item's current size, used to identify which order line to remove from when there is more than one line for this item.",
      },
      quantityToRemove: {
        type: "integer",
        description: "How many units to remove. Omit to remove the entire line regardless of its quantity.",
        minimum: 1,
      },
    },
    required: ["itemId"],
  },
};

function executeRemoveOrderItem(order, input) {
  const { itemId, currentSize, quantityToRemove } = input || {};

  if (!itemId) {
    return { isError: true, content: "itemId is required to identify which order item to remove." };
  }
  if (quantityToRemove !== undefined && (!Number.isInteger(quantityToRemove) || quantityToRemove < 1)) {
    return { isError: true, content: "quantityToRemove must be a positive whole number." };
  }

  const item = findMenuItem(itemId);
  const itemName = item ? item.name : itemId;

  let matches = order.items.filter((line) => line.id === itemId);
  if (matches.length === 0) {
    return { isError: true, content: `There is no "${itemName}" in the current order to remove.` };
  }
  if (matches.length > 1 && currentSize) {
    matches = matches.filter((line) => line.size === currentSize);
    if (matches.length === 0) {
      return { isError: true, content: `No "${itemName}" with size "${currentSize}" was found in the order.` };
    }
  }
  if (matches.length > 1) {
    const descriptions = matches
      .map((line) => {
        const optionsSummary = Object.values(line.options || {}).join(", ");
        return `${line.size}${optionsSummary ? ` (${optionsSummary})` : ""}`;
      })
      .join("; ");
    return {
      isError: true,
      content: `There are multiple "${itemName}" items in the order (${descriptions}). Pass currentSize to say which one to remove.`,
    };
  }

  const target = matches[0];
  const targetIndex = order.items.indexOf(target);

  if (quantityToRemove === undefined || quantityToRemove >= target.quantity) {
    order.items.splice(targetIndex, 1);
    return { isError: false, content: `Removed ${target.quantity}x ${target.size} ${itemName} from the order.` };
  }

  target.quantity -= quantityToRemove;
  const remainWord = target.quantity === 1 ? "remains" : "remain";
  return {
    isError: false,
    content: `Removed ${quantityToRemove}x ${itemName}. ${target.quantity}x ${target.size} ${itemName} ${remainWord} in the order.`,
  };
}

const getOrderSummaryTool = {
  name: "get_order_summary",
  description:
    "Get a concise, accurate summary of everything currently in the customer's order (items, quantities, sizes, and customizations). Call this whenever the customer asks what's in their order, or before final checkout, instead of relying on memory of earlier tool results.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

function executeGetOrderSummary(order) {
  if (!order.items.length) {
    return { isError: false, content: "The order is currently empty." };
  }

  const lines = order.items.map((line) => {
    const optionsSummary = Object.values(line.options || {}).join(", ");
    return `${line.quantity}x ${line.size} ${line.name}${optionsSummary ? ` (${optionsSummary})` : ""}`;
  });

  return { isError: false, content: `Current order: ${lines.join("; ")}.` };
}

const getOrderTotalTool = {
  name: "get_order_total",
  description:
    "Get the order's accurate, deterministically calculated subtotal, discount, tax, delivery fee (if applicable), and grand total. Always call this instead of calculating, estimating, or adding up prices yourself — never state a total or any dollar amount that didn't come from this tool.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

function executeGetOrderTotal(order) {
  const totals = calculateOrderTotals(order);

  const parts = [`Subtotal: $${totals.subtotal.toFixed(2)}`];
  if (totals.discount > 0) parts.push(`Discount: -$${totals.discount.toFixed(2)}`);
  parts.push(`Tax: $${totals.tax.toFixed(2)}`);
  if (totals.deliveryFee > 0) parts.push(`Delivery fee: $${totals.deliveryFee.toFixed(2)}`);
  parts.push(`Total: $${totals.total.toFixed(2)}`);

  return { isError: false, content: parts.join("; ") };
}

const getFinalOrderReviewTool = {
  name: "get_final_order_review",
  description:
    "Get a complete, accurate order review before checkout: items with quantities and customizations, fulfillment details (pickup or delivery), any currently valid applied promotion, and the deterministic total. Always call this before asking the customer to confirm checkout — never assemble this review yourself from memory.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

function executeGetFinalOrderReview(order) {
  if (!order.items.length) {
    return { isError: true, content: "The order is empty — add at least one item before reviewing for checkout." };
  }

  const sections = [];

  const itemLines = order.items.map((line) => {
    const optionsSummary = Object.values(line.options || {}).join(", ");
    return `- ${line.quantity}x ${line.size} ${line.name}${optionsSummary ? ` (${optionsSummary})` : ""}`;
  });
  sections.push(`Items:\n${itemLines.join("\n")}`);

  if (order.orderType === "pickup") {
    const timePart = order.customer.pickupTime ? `, estimated pickup time: ${order.customer.pickupTime}` : "";
    sections.push(`Fulfillment: Pickup for ${order.customer.name || "(name not yet provided)"}${timePart}.`);
  } else if (order.orderType === "delivery") {
    const apt = order.customer.apartment ? `, ${order.customer.apartment}` : "";
    const instructions = order.customer.deliveryInstructions
      ? ` Delivery instructions: ${order.customer.deliveryInstructions}.`
      : "";
    const addressStatus = order.customer.addressConfirmed
      ? "confirmed"
      : "NOT YET confirmed by the customer — confirm it before checkout";
    sections.push(
      `Fulfillment: Delivery for ${order.customer.name || "(name not yet provided)"}, phone ${
        order.customer.phone || "(not yet provided)"
      }, to ${order.customer.address || "(address not yet provided)"}${apt} (address ${addressStatus}).${instructions}`
    );
  } else {
    sections.push("Fulfillment: not yet selected — ask the customer whether this is pickup or delivery.");
  }

  let promotionLine = "Promotion: none applied.";
  if (order.promotion) {
    const promotion = findPromotion(order.promotion.id);
    if (promotion && promotion.active && isEligible(promotion, order)) {
      promotionLine = `Promotion: "${promotion.name}" applied — ${promotion.rule}`;
    } else {
      promotionLine = `Promotion: "${order.promotion.name}" was applied earlier but is no longer valid, so it will NOT be discounted — mention this to the customer.`;
    }
  }
  sections.push(promotionLine);

  const totals = calculateOrderTotals(order);
  const totalParts = [`Subtotal: $${totals.subtotal.toFixed(2)}`];
  if (totals.discount > 0) totalParts.push(`Discount: -$${totals.discount.toFixed(2)}`);
  totalParts.push(`Tax: $${totals.tax.toFixed(2)}`);
  if (totals.deliveryFee > 0) totalParts.push(`Delivery fee: $${totals.deliveryFee.toFixed(2)}`);
  totalParts.push(`Total: $${totals.total.toFixed(2)}`);
  sections.push(totalParts.join("; "));

  return { isError: false, content: sections.join("\n\n") };
}

module.exports = {
  addItemToOrderTool,
  executeAddItemToOrder,
  modifyOrderItemTool,
  executeModifyOrderItem,
  removeOrderItemTool,
  executeRemoveOrderItem,
  getOrderTotalTool,
  executeGetOrderTotal,
  getOrderSummaryTool,
  executeGetOrderSummary,
  getFinalOrderReviewTool,
  executeGetFinalOrderReview,
};
