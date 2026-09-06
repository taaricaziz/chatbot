import type { MetadataRoute } from "next";
import { getAllSlugs } from "@/lib/repositories/menu";

const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

/**
 * Generated from menu data, not hand-maintained — a new dish is indexable
 * the moment it exists. In Phase 4 the import swaps to the database and
 * nothing else here changes.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = ["", "/menu", "/order", "/reserve", "/about", "/contact"].map(
    (path) => ({
      url: `${base}${path}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.8,
    }),
  );

  const slugs = await getAllSlugs();
  const dishes = slugs.map((slug) => ({
    url: `${base}/menu/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...routes, ...dishes];
}
