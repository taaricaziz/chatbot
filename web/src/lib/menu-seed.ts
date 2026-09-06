import { rupees, type Paisa } from "./money";

/**
 * Menu content for the static site (Phase 3).
 *
 * PHASE 4 NOTE: this module is the bridge, not the destination. These exact
 * records become `prisma/seed.ts` and the database becomes the single source
 * of truth. Nothing outside this file may hardcode a menu item or a price —
 * components read from here now and from the database later, so the swap is
 * mechanical.
 *
 * Prices are original, authored on realistic Karachi café bands. They are
 * not any real restaurant's prices.
 */

export type Category =
  | "Breakfast"
  | "Soups"
  | "Appetizers"
  | "Salads"
  | "Sandwiches"
  | "Burgers"
  | "Pizza"
  | "Pasta"
  | "Main Courses"
  | "Seafood"
  | "Desserts"
  | "Hot Beverages"
  | "Cold Beverages"
  | "Shakes"
  | "Smoothies";

export interface MenuItem {
  id: string;
  slug: string;
  name: string;
  category: Category;
  description: string;
  price: Paisa;
  isVegetarian: boolean;
  isSpicy: boolean;
  isPopular: boolean;
  isRecommended: boolean;
  isAvailable: boolean;
}

export const MENU: readonly MenuItem[] = [
  // ---------- Breakfast ----------
  {
    id: "bf-01",
    slug: "bukhari-breakfast-plate",
    name: "Bukhari Breakfast Plate",
    category: "Breakfast",
    description:
      "Two eggs your way, chicken sausage, sautéed mushrooms, grilled tomato and a thick slice of buttered sourdough.",
    price: rupees(1290),
    isVegetarian: false,
    isSpicy: false,
    isPopular: true,
    isRecommended: true,
    isAvailable: true,
  },
  {
    id: "bf-02",
    slug: "shakshuka-sourdough",
    name: "Shakshuka & Sourdough",
    category: "Breakfast",
    description:
      "Eggs baked into a slow-cooked tomato and pepper stew, finished with feta, coriander and a warm flatbread.",
    price: rupees(1150),
    isVegetarian: true,
    isSpicy: true,
    isPopular: true,
    isRecommended: false,
    isAvailable: true,
  },
  {
    id: "bf-03",
    slug: "buttermilk-pancakes",
    name: "Buttermilk Pancakes",
    category: "Breakfast",
    description:
      "Three tall pancakes with whipped honey butter, toasted walnuts and a jug of maple on the side.",
    price: rupees(890),
    isVegetarian: true,
    isSpicy: false,
    isPopular: false,
    isRecommended: true,
    isAvailable: true,
  },
  {
    id: "bf-04",
    slug: "anda-paratha-benedict",
    name: "Anda Paratha Benedict",
    category: "Breakfast",
    description:
      "Poached eggs and spiced chicken on a flaky paratha, under a hollandaise loosened with lemon and green chilli.",
    price: rupees(1190),
    isVegetarian: false,
    isSpicy: true,
    isPopular: true,
    isRecommended: true,
    isAvailable: true,
  },

  // ---------- Pasta ----------
  {
    id: "pa-01",
    slug: "chilli-garlic-chicken-spaghetti",
    name: "Chilli Garlic Chicken Spaghetti",
    category: "Pasta",
    description:
      "Spaghetti with grilled chicken, turkey bacon, red chillies, confit garlic and sundried tomatoes.",
    price: rupees(1860),
    isVegetarian: false,
    isSpicy: true,
    isPopular: true,
    isRecommended: true,
    isAvailable: true,
  },
  {
    id: "pa-02",
    slug: "alfredo-bianco",
    name: "Alfredo Bianco",
    category: "Pasta",
    description:
      "Fettuccine in a slow-reduced cream and parmesan sauce, cracked black pepper, grilled chicken.",
    price: rupees(1690),
    isVegetarian: false,
    isSpicy: false,
    isPopular: true,
    isRecommended: false,
    isAvailable: true,
  },

  // ---------- Burgers & Sandwiches ----------
  {
    id: "bu-01",
    slug: "counter-cheeseburger",
    name: "The Counter Cheeseburger",
    category: "Burgers",
    description:
      "Two smashed patties, aged cheddar, pickles, white onion and house sauce in a toasted potato bun.",
    price: rupees(1390),
    isVegetarian: false,
    isSpicy: false,
    isPopular: true,
    isRecommended: true,
    isAvailable: true,
  },
  {
    id: "sa-01",
    slug: "the-gootee-club",
    name: "The Gootee Club",
    category: "Sandwiches",
    description:
      "Roast chicken, turkey bacon, egg, lettuce and tomato, triple-stacked on toasted milk bread. Served with fries.",
    price: rupees(1490),
    isVegetarian: false,
    isSpicy: false,
    isPopular: true,
    isRecommended: false,
    isAvailable: true,
  },

  // ---------- Salads & Pizza ----------
  {
    id: "sl-01",
    slug: "charred-caesar",
    name: "Charred Caesar",
    category: "Salads",
    description:
      "Grilled romaine, parmesan crisp, sourdough croutons and a proper anchovy dressing. Add chicken if you like.",
    price: rupees(1290),
    isVegetarian: false,
    isSpicy: false,
    isPopular: false,
    isRecommended: true,
    isAvailable: true,
  },
  {
    id: "pz-01",
    slug: "margherita",
    name: "Margherita",
    category: "Pizza",
    description:
      "San Marzano tomato, fior di latte, basil and olive oil on a 48-hour cold-fermented base.",
    price: rupees(1290),
    isVegetarian: true,
    isSpicy: false,
    isPopular: true,
    isRecommended: false,
    isAvailable: true,
  },

  // ---------- Hot Beverages ----------
  {
    id: "hb-01",
    slug: "flat-white",
    name: "Flat White",
    category: "Hot Beverages",
    description: "Double ristretto, steamed milk poured thin. Our house blend.",
    price: rupees(620),
    isVegetarian: true,
    isSpicy: false,
    isPopular: true,
    isRecommended: true,
    isAvailable: true,
  },
  {
    id: "hb-02",
    slug: "cortado",
    name: "Cortado",
    category: "Hot Beverages",
    description: "Equal parts espresso and warm milk. Small, strong, balanced.",
    price: rupees(580),
    isVegetarian: true,
    isSpicy: false,
    isPopular: false,
    isRecommended: true,
    isAvailable: true,
  },
  {
    id: "hb-03",
    slug: "karak-chai",
    name: "Karak Chai",
    category: "Hot Beverages",
    description:
      "Boiled long with cardamom and full-cream milk, the way it should be.",
    price: rupees(380),
    isVegetarian: true,
    isSpicy: false,
    isPopular: true,
    isRecommended: false,
    isAvailable: true,
  },
  {
    id: "hb-04",
    slug: "pour-over",
    name: "Single Origin Pour Over",
    category: "Hot Beverages",
    description:
      "Rotating single origin, ground to order and brewed by hand. Ask what's on today.",
    price: rupees(780),
    isVegetarian: true,
    isSpicy: false,
    isPopular: false,
    isRecommended: true,
    isAvailable: false,
  },

  // ---------- Desserts ----------
  {
    id: "de-01",
    slug: "basque-cheesecake",
    name: "Burnt Basque Cheesecake",
    category: "Desserts",
    description:
      "Caramelised on top, barely set in the middle. Served with a spoon of crème fraîche.",
    price: rupees(890),
    isVegetarian: true,
    isSpicy: false,
    isPopular: true,
    isRecommended: true,
    isAvailable: true,
  },
  {
    id: "de-02",
    slug: "date-walnut-pudding",
    name: "Date & Walnut Pudding",
    category: "Desserts",
    description:
      "Warm sticky pudding under toffee sauce, with a scoop of vanilla melting into it.",
    price: rupees(790),
    isVegetarian: true,
    isSpicy: false,
    isPopular: false,
    isRecommended: true,
    isAvailable: true,
  },

  // ---------- Shakes ----------
  {
    id: "sh-01",
    slug: "salted-caramel-shake",
    name: "Salted Caramel Shake",
    category: "Shakes",
    description:
      "Thick vanilla shake, house salted caramel, whipped cream and a caramel shard.",
    price: rupees(890),
    isVegetarian: true,
    isSpicy: false,
    isPopular: true,
    isRecommended: false,
    isAvailable: true,
  },
] as const;

// ---------- selectors ----------

export const byCategory = (category: Category): MenuItem[] =>
  MENU.filter((i) => i.category === category);

export const recommended = (limit?: number): MenuItem[] => {
  const items = MENU.filter((i) => i.isRecommended && i.isAvailable);
  return limit ? items.slice(0, limit) : items;
};

export const popular = (limit?: number): MenuItem[] => {
  const items = MENU.filter((i) => i.isPopular && i.isAvailable);
  return limit ? items.slice(0, limit) : items;
};

export const findBySlug = (slug: string): MenuItem | undefined =>
  MENU.find((i) => i.slug === slug);
