import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Whether a database is configured at all.
 *
 * The menu repository falls back to typed seed data when this is false, so
 * the site runs on a machine with no credentials. That fallback is a
 * deliberate convenience with a real cost — two code paths — so it is
 * announced loudly at first use rather than failing silently and leaving
 * someone wondering why an admin price edit never appears.
 */
export const isDatabaseConfigured = Boolean(
  process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== "",
);

/**
 * Next.js dev reloads modules on every edit; without caching the client on
 * globalThis you accumulate connections until Postgres refuses new ones.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Constructed lazily, on first query — never at module load.
 *
 * Prisma 7 requires a driver adapter, and building one needs a connection
 * string. Constructing at import time would therefore crash `next build` on
 * any machine without DATABASE_URL, even for pages that never touch the
 * database. Every route here is statically prerendered, so that is most of
 * them.
 */
export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Set it in web/.env to query the database, " +
        "or let the menu repository fall back to seed data.",
    );
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  // Cached in every environment: on serverless the module is reused across
  // warm invocations, so rebuilding a pool per request would exhaust it.
  globalForPrisma.prisma = client;
  return client;
}
