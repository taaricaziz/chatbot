import { describe, expect, it } from "vitest";
import { expandQuery, matchesTerms } from "@/lib/services/menu-search";
import { MENU } from "@/lib/menu-seed";

const find = (query: string) => {
  const terms = expandQuery(query);
  return MENU.filter((i) => matchesTerms(i, terms)).map((i) => i.slug);
};

describe("the bug this exists for", () => {
  it("finds the coffees when a customer asks for coffee", () => {
    // Found by running the assistant against a real model: not one item on
    // the menu contains the word "coffee", so the search returned nothing and
    // the assistant truthfully told a customer there was none.
    const found = find("coffee");
    expect(found).toContain("flat-white");
    expect(found).toContain("cortado");
    expect(found).toContain("pour-over");
  });

  it("still finds things by their actual name", () => {
    expect(find("cortado")).toEqual(["cortado"]);
  });
});

describe("expanding what a customer said", () => {
  it("always keeps the original word first", () => {
    expect(expandQuery("coffee")[0]).toBe("coffee");
  });

  it("lower-cases and trims, so typing is forgiving", () => {
    expect(expandQuery("  COFFEE ")[0]).toBe("coffee");
  });

  it("returns nothing for an empty query, meaning no filter", () => {
    expect(expandQuery("")).toEqual([]);
    expect(expandQuery("   ")).toEqual([]);
  });

  it("expands a word inside a phrase", () => {
    // "iced coffee" is not itself in the table; "coffee" is.
    expect(expandQuery("iced coffee")).toContain("hot beverages");
  });

  it("leaves an unknown word exactly as it was", () => {
    expect(expandQuery("shakshuka")).toEqual(["shakshuka"]);
  });
});

describe("matching an item", () => {
  const item = {
    name: "Flat White",
    description: "Double ristretto, steamed milk poured thin.",
    category: "Hot Beverages",
  };

  it("matches on any of name, description or category", () => {
    expect(matchesTerms(item, ["flat"])).toBe(true);
    expect(matchesTerms(item, ["ristretto"])).toBe(true);
    expect(matchesTerms(item, ["hot beverages"])).toBe(true);
  });

  it("does not match something genuinely absent", () => {
    expect(matchesTerms(item, ["burger"])).toBe(false);
  });

  it("treats no terms as no filter, rather than as no results", () => {
    expect(matchesTerms(item, [])).toBe(true);
  });
});

describe("the words people actually use", () => {
  const cases: [string, string][] = [
    ["tea", "karak-chai"],
    ["chai", "karak-chai"],
    ["burger", "counter-cheeseburger"],
    ["pasta", "alfredo-bianco"],
    ["dessert", "basque-cheesecake"],
    ["sweet", "date-walnut-pudding"],
    ["breakfast", "shakshuka-sourdough"],
    ["eggs", "anda-paratha-benedict"],
  ];

  for (const [said, expected] of cases) {
    it(`"${said}" finds ${expected}`, () => {
      expect(find(said)).toContain(expected);
    });
  }

  it("never returns the whole menu for a specific word", () => {
    // A synonym table that matched everything would be worse than no search.
    expect(find("burger").length).toBeLessThan(MENU.length);
  });
});
