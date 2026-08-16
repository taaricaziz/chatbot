const fs = require("fs");
const path = require("path");

const MENU_PATH = path.resolve(__dirname, "..", "data", "menu.json");

function loadMenu() {
  const raw = fs.readFileSync(MENU_PATH, "utf8");
  return JSON.parse(raw);
}

function findMenuItem(itemId) {
  const menu = loadMenu();
  return menu.items.find((item) => item.id === itemId) || null;
}

module.exports = { loadMenu, findMenuItem };
