const fs = require("fs");
const path = require("path");

const PROMOTIONS_PATH = path.resolve(__dirname, "..", "data", "promotions.json");

function loadPromotions() {
  const raw = fs.readFileSync(PROMOTIONS_PATH, "utf8");
  return JSON.parse(raw);
}

function findPromotion(promotionId) {
  const data = loadPromotions();
  return data.promotions.find((p) => p.id === promotionId) || null;
}

module.exports = { loadPromotions, findPromotion };
