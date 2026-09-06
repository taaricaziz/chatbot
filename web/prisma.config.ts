import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved connection URLs out of schema.prisma into this file.
 *
 * Read via `process.env` rather than Prisma's `env()` helper on purpose:
 * `env()` throws at config-load time if the variable is missing, which
 * breaks `prisma generate` on a machine with no database credentials.
 * Codegen needs no connection; a missing URL should fail at query time with
 * a useful message (see src/lib/db.ts), not at build time with a cryptic one.
 *
 * Note: Prisma 7's datasource config accepts only `url` and
 * `shadowDatabaseUrl` — there is no `directUrl` here. Supabase's transaction
 * pooler (port 6543) cannot run DDL, so if you later run `prisma migrate`
 * from this machine, point DATABASE_URL at the direct connection (5432) for
 * that command. Schema changes in this project are currently applied as
 * Supabase migrations instead.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
