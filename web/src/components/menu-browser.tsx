"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { DishCard } from "@/components/dish-card";
import type { Category, MenuItem } from "@/lib/repositories/menu";
import styles from "./menu-browser.module.css";

type Diet = "all" | "vegetarian" | "spicy";

export function MenuBrowser({
  items,
  categories,
}: {
  items: MenuItem[];
  categories: { name: Category; count: number }[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [diet, setDiet] = useState<Diet>("all");
  const [hideUnavailable, setHideUnavailable] = useState(false);

  // Keeps typing responsive: the input updates immediately, the (heavier)
  // filtered grid re-renders at React's leisure.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (diet === "vegetarian" && !i.isVegetarian) return false;
      if (diet === "spicy" && !i.isSpicy) return false;
      if (hideUnavailable && !i.isAvailable) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    });
  }, [items, deferredQuery, category, diet, hideUnavailable]);

  // Grouped so the page still reads as a menu rather than a flat search dump.
  const grouped = useMemo(() => {
    const map = new Map<Category, MenuItem[]>();
    for (const item of filtered) {
      const list = map.get(item.category);
      if (list) list.push(item);
      else map.set(item.category, [item]);
    }
    return [...map.entries()];
  }, [filtered]);

  const isFiltered =
    query.trim() !== "" ||
    category !== "all" ||
    diet !== "all" ||
    hideUnavailable;

  const reset = () => {
    setQuery("");
    setCategory("all");
    setDiet("all");
    setHideUnavailable(false);
  };

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.searchWrap}>
          <SearchIcon />
          <input
            type="search"
            className={styles.search}
            placeholder="Search dishes, ingredients, categories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the menu"
          />
          {query && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className={styles.filterRow}>
          <fieldset className={styles.chipSet}>
            <legend className="visually-hidden">Dietary filter</legend>
            {(
              [
                ["all", "Everything"],
                ["vegetarian", "Vegetarian"],
                ["spicy", "Spicy"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`${styles.chip} ${diet === value ? styles.chipOn : ""}`}
                aria-pressed={diet === value}
                onClick={() => setDiet(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={hideUnavailable}
              onChange={(e) => setHideUnavailable(e.target.checked)}
            />
            <span>Available now</span>
          </label>
        </div>
      </div>

      <nav className={styles.categoryNav} aria-label="Menu categories">
        <button
          type="button"
          className={`${styles.catBtn} ${category === "all" ? styles.catOn : ""}`}
          aria-pressed={category === "all"}
          onClick={() => setCategory("all")}
        >
          All <span className={styles.catCount}>{items.length}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.name}
            type="button"
            className={`${styles.catBtn} ${category === c.name ? styles.catOn : ""}`}
            aria-pressed={category === c.name}
            onClick={() => setCategory(c.name)}
          >
            {c.name} <span className={styles.catCount}>{c.count}</span>
          </button>
        ))}
      </nav>

      <p className={styles.resultLine} role="status" aria-live="polite">
        {filtered.length === items.length
          ? `${items.length} dishes`
          : `${filtered.length} of ${items.length} dishes`}
        {isFiltered && (
          <button type="button" className={styles.reset} onClick={reset}>
            Clear filters
          </button>
        )}
      </p>

      {grouped.length === 0 ? (
        <div className={styles.empty}>
          <p className={`display ${styles.emptyHeading}`}>
            Nothing matches that.
          </p>
          <p className={styles.emptyBody}>
            Try a shorter search, or clear the filters to see the whole menu.
          </p>
          <button type="button" className={styles.emptyBtn} onClick={reset}>
            Clear filters
          </button>
        </div>
      ) : (
        grouped.map(([cat, catItems]) => (
          <section
            key={cat}
            id={cat.toLowerCase().replace(/\s+/g, "-")}
            className={styles.catSection}
            aria-labelledby={`h-${cat.replace(/\s+/g, "-")}`}
          >
            <h2
              id={`h-${cat.replace(/\s+/g, "-")}`}
              className={`display ${styles.catHeading}`}
            >
              {cat}
            </h2>
            <div className={styles.grid}>
              {catItems.map((item) => (
                <DishCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      className={styles.searchIcon}
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}
