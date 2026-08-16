const { findMenuItem } = require("./menu");

const recommendItemsTool = {
  name: "recommend_items",
  description:
    "Suggest 1-2 relevant add-on items from the menu (e.g. a pastry with a coffee, a cold drink with a sandwich). Only call this with real, available menu item ids — never invent one. Suggest, don't pressure: call this at most once per customer turn, and never re-suggest an item the customer has already declined.",
  input_schema: {
    type: "object",
    properties: {
      itemIds: {
        type: "array",
        description: "1 or 2 menu item ids to recommend, most relevant first.",
        items: { type: "string" },
        minItems: 1,
        maxItems: 2,
      },
      reason: {
        type: "string",
        description: "A short, non-pushy reason these pair well with what the customer is ordering.",
      },
    },
    required: ["itemIds"],
  },
};

function executeRecommendItems(input) {
  const { itemIds } = input || {};

  if (!Array.isArray(itemIds) || itemIds.length < 1) {
    return { isError: true, content: "itemIds must include at least one menu item id to recommend." };
  }
  if (itemIds.length > 2) {
    return { isError: true, content: "Recommend at most 2 items at a time." };
  }

  const recommendations = [];
  for (const itemId of itemIds) {
    const item = findMenuItem(itemId);
    if (!item) {
      return { isError: true, content: `No menu item with id "${itemId}" exists. Only recommend real menu items.` };
    }
    if (!item.available) {
      return { isError: true, content: `"${item.name}" is currently unavailable and should not be recommended.` };
    }
    recommendations.push(`${item.name} ($${item.price.toFixed(2)}) — ${item.description}`);
  }

  return { isError: false, content: `Confirmed recommendation(s): ${recommendations.join("; ")}` };
}

module.exports = { recommendItemsTool, executeRecommendItems };
