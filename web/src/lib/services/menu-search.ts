/**
 * What customers call things, versus what the menu calls them.
 *
 * Found by running the assistant for real: a customer asked "what coffee do
 * you have?", the search matched name, description and category literally,
 * and not one of Flat White, Cortado, Karak Chai or Pour Over contains the
 * word "coffee". The assistant then said, truthfully and uselessly, that
 * there was no coffee.
 *
 * The model was not at fault and neither was the menu — the search was. This
 * is the layer that was missing.
 *
 * Pure and data-driven: adding a word people use is editing the table below,
 * not changing any logic.
 */

/** A customer's word, and the menu words it should also match. */
const SYNONYMS: Record<string, string[]> = {
  coffee: ["hot beverages", "espresso", "ristretto", "flat white", "cortado", "pour over", "blend"],
  espresso: ["ristretto", "flat white", "cortado", "hot beverages"],
  latte: ["flat white", "cortado", "hot beverages"],
  cappuccino: ["flat white", "cortado", "hot beverages"],
  tea: ["chai", "hot beverages"],
  chai: ["karak", "hot beverages"],
  drink: ["hot beverages", "cold beverages", "shake"],
  drinks: ["hot beverages", "cold beverages", "shake"],
  breakfast: ["eggs", "pancakes", "shakshuka", "paratha", "benedict"],
  eggs: ["breakfast", "shakshuka", "benedict", "omelette"],
  dessert: ["cheesecake", "pudding", "sweet"],
  desserts: ["cheesecake", "pudding", "sweet"],
  sweet: ["cheesecake", "pudding", "dessert"],
  burger: ["cheeseburger", "patty"],
  pasta: ["spaghetti", "fettuccine", "alfredo"],
  sandwich: ["club", "toast"],
  veg: ["vegetarian"],
  vegetarian: ["veg"],
  spicy: ["chilli", "chili"],
};

/**
 * Every term a query should match on.
 *
 * The original always comes first and is always kept: synonyms widen a
 * search, they never replace it.
 */
export function expandQuery(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const terms = new Set<string>([q]);

  // Whole query first, then each word — so "iced coffee" picks up coffee's
  // synonyms even though the pair is not itself in the table.
  for (const word of [q, ...q.split(/\s+/)]) {
    for (const synonym of SYNONYMS[word] ?? []) terms.add(synonym);
  }

  return [...terms];
}

/** Does this item match any of the expanded terms? */
export function matchesTerms(
  item: { name: string; description: string; category: string },
  terms: string[],
): boolean {
  if (terms.length === 0) return true;
  const haystack =
    `${item.name} ${item.description} ${item.category}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}
