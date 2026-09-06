import "server-only";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { MENU, type Category, type MenuItem } from "@/lib/menu-seed";
import { expandQuery, matchesTerms } from "@/lib/services/menu-search";

/**
 * The seam between the app and its menu data.
 *
 * Two backends live behind one interface:
 *
 *   - PostgreSQL via Prisma, when DATABASE_URL is set. This is the real one.
 *   - The typed seed module, when it is not.
 *
 * The fallback exists so the site runs on a machine without credentials, and
 * so Phase 3 keeps working while the database is wired up. It is a real cost
 * — two code paths that can diverge — so it is announced at startup and
 * should be deleted once the database is the only source in every
 * environment.
 *
 * Nothing outside this module may import `menu-seed` or `prisma` directly.
 */

export type { MenuItem, Category };

let warned = false;
function usingSeedData(): boolean {
  if (!isDatabaseConfigured && !warned) {
    warned = true;
    console.warn(
      "[menu] DATABASE_URL is not set — serving the typed seed menu. " +
        "Admin edits and persistence are unavailable until it is configured.",
    );
  }
  return !isDatabaseConfigured;
}

/** Maps a Prisma row onto the shape the UI already consumes. */
type MenuItemRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  pricePaisa: number;
  isVegetarian: boolean;
  isSpicy: boolean;
  isPopular: boolean;
  isRecommended: boolean;
  isAvailable: boolean;
  category: { name: string };
};

function toMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category.name as Category,
    description: row.description,
    price: row.pricePaisa,
    isVegetarian: row.isVegetarian,
    isSpicy: row.isSpicy,
    isPopular: row.isPopular,
    isRecommended: row.isRecommended,
    isAvailable: row.isAvailable,
  };
}

const ITEM_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  pricePaisa: true,
  isVegetarian: true,
  isSpicy: true,
  isPopular: true,
  isRecommended: true,
  isAvailable: true,
  category: { select: { name: true } },
} as const;

const ITEM_ORDER = [
  { category: { sortOrder: "asc" as const } },
  { sortOrder: "asc" as const },
];

export interface MenuFilters {
  category?: Category;
  query?: string;
  vegetarianOnly?: boolean;
  availableOnly?: boolean;
}

export async function getMenu(filters: MenuFilters = {}): Promise<MenuItem[]> {
  if (usingSeedData()) {
    let items = [...MENU];
    if (filters.category) items = items.filter((i) => i.category === filters.category);
    if (filters.vegetarianOnly) items = items.filter((i) => i.isVegetarian);
    if (filters.availableOnly) items = items.filter((i) => i.isAvailable);
    const q = filters.query?.trim();
    if (q) {
      // Expanded first: customers say "coffee", the menu says "Hot Beverages".
      const terms = expandQuery(q);
      items = items.filter((i) => matchesTerms(i, terms));
    }
    return items.map(withOverrides);
  }

  const q = filters.query?.trim();

  const rows = await getPrisma().menuItem.findMany({
    where: {
      ...(filters.category ? { category: { name: filters.category } } : {}),
      ...(filters.vegetarianOnly ? { isVegetarian: true } : {}),
      ...(filters.availableOnly ? { isAvailable: true } : {}),
      ...(q
        ? {
            // One OR arm per expanded term, so the database search behaves
            // exactly like the seed-data one.
            OR: expandQuery(q).flatMap((term) => [
              { name: { contains: term, mode: "insensitive" as const } },
              { description: { contains: term, mode: "insensitive" as const } },
              { category: { name: { contains: term, mode: "insensitive" as const } } },
            ]),
          }
        : {}),
    },
    select: ITEM_SELECT,
    orderBy: ITEM_ORDER,
  });

  return rows.map(toMenuItem);
}

export async function getCategories(): Promise<
  { name: Category; count: number }[]
> {
  if (usingSeedData()) {
    const counts = new Map<Category, number>();
    for (const item of MENU) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }

  const rows = await getPrisma().menuCategory.findMany({
    where: { isActive: true, items: { some: {} } },
    select: { name: true, _count: { select: { items: true } } },
    orderBy: { sortOrder: "asc" },
  });

  return rows.map((r) => ({ name: r.name as Category, count: r._count.items }));
}

export async function getItemBySlug(slug: string): Promise<MenuItem | null> {
  if (usingSeedData()) {
    const found = MENU.find((i) => i.slug === slug);
    return found ? withOverrides(found) : null;
  }

  const row = await getPrisma().menuItem.findUnique({
    where: { slug },
    select: ITEM_SELECT,
  });
  return row ? toMenuItem(row) : null;
}

export async function getAllSlugs(): Promise<string[]> {
  if (usingSeedData()) return MENU.map((i) => i.slug);

  const rows = await getPrisma().menuItem.findMany({ select: { slug: true } });
  return rows.map((r) => r.slug);
}

export async function getRecommended(limit?: number): Promise<MenuItem[]> {
  if (usingSeedData()) {
    const items = MENU.map(withOverrides).filter((i) => i.isRecommended && i.isAvailable);
    return limit ? items.slice(0, limit) : items;
  }

  const rows = await getPrisma().menuItem.findMany({
    where: { isRecommended: true, isAvailable: true },
    select: ITEM_SELECT,
    orderBy: ITEM_ORDER,
    ...(limit ? { take: limit } : {}),
  });
  return rows.map(toMenuItem);
}

export async function getPopular(limit?: number): Promise<MenuItem[]> {
  if (usingSeedData()) {
    const items = MENU.map(withOverrides).filter((i) => i.isPopular && i.isAvailable);
    return limit ? items.slice(0, limit) : items;
  }

  const rows = await getPrisma().menuItem.findMany({
    where: { isPopular: true, isAvailable: true },
    select: ITEM_SELECT,
    orderBy: ITEM_ORDER,
    ...(limit ? { take: limit } : {}),
  });
  return rows.map(toMenuItem);
}

export async function getByCategory(category: Category): Promise<MenuItem[]> {
  if (usingSeedData()) return MENU.filter((i) => i.category === category).map(withOverrides);

  const rows = await getPrisma().menuItem.findMany({
    where: { category: { name: category } },
    select: ITEM_SELECT,
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toMenuItem);
}

/**
 * Staff overrides layered on top of the seed data when there is no database.
 * Pinned to globalThis so an edit made in a server action is visible to the
 * page rendered next -- separate module graphs otherwise get separate Maps.
 */
const overrides = ((globalThis as unknown as {
  gooteeMenuOverrides?: Map<string, { isAvailable?: boolean; price?: number }>;
}).gooteeMenuOverrides ??= new Map());

function withOverrides(item: MenuItem): MenuItem {
  const o = overrides.get(item.slug);
  if (!o) return item;
  return {
    ...item,
    ...(o.isAvailable !== undefined ? { isAvailable: o.isAvailable } : {}),
    ...(o.price !== undefined ? { price: o.price } : {}),
  };
}

/** Returns the previous value, for the audit trail. */
export async function setItemAvailability(
  slug: string,
  isAvailable: boolean,
): Promise<boolean | null> {
  const current = await getItemBySlug(slug);
  if (!current) return null;

  if (!isDatabaseConfigured) {
    overrides.set(slug, { ...overrides.get(slug), isAvailable });
  } else {
    await getPrisma().menuItem.update({ where: { slug }, data: { isAvailable } });
  }
  return current.isAvailable;
}

export async function setItemPrice(
  slug: string,
  pricePaisa: number,
): Promise<number | null> {
  const current = await getItemBySlug(slug);
  if (!current) return null;

  if (!isDatabaseConfigured) {
    overrides.set(slug, { ...overrides.get(slug), price: pricePaisa });
  } else {
    await getPrisma().menuItem.update({ where: { slug }, data: { pricePaisa } });
  }
  return current.price;
}

export async function getRelated(
  item: MenuItem,
  limit = 3,
): Promise<MenuItem[]> {
  if (usingSeedData()) {
    return MENU.filter((i) => i.category === item.category && i.id !== item.id)
      .map(withOverrides)
      .slice(0, limit);
  }

  const rows = await getPrisma().menuItem.findMany({
    where: { category: { name: item.category }, id: { not: item.id } },
    select: ITEM_SELECT,
    orderBy: { sortOrder: "asc" },
    take: limit,
  });
  return rows.map(toMenuItem);
}
