import "server-only";

import { createDatabase, type AppDatabase } from "@/db/client";
import { loadBusinessConfig, type BusinessConfig } from "./business-config.ts";
import { loadEnv, type AppEnv } from "./env.ts";

export interface ServerContext {
  readonly database: AppDatabase;
  readonly env: AppEnv;
  readonly business: BusinessConfig;
}

/**
 * Only the SQLite handle is cached. Next.js reloads modules on every edit in
 * development, which would otherwise leak one connection per reload.
 *
 * The business config is re-read on every call on purpose: the operator edits
 * config/business.json by hand, and a cached copy would keep serving stale
 * claims and links until the server was restarted.
 */
const databaseCacheKey = Symbol.for("prospecting.database");
type DatabaseCarrier = typeof globalThis & { [databaseCacheKey]?: AppDatabase };

export function getServerContext(): ServerContext {
  const env = loadEnv(process.env);
  const carrier = globalThis as DatabaseCarrier;

  carrier[databaseCacheKey] ??= createDatabase(env.databaseUrl);

  return {
    env,
    business: loadBusinessConfig(env.businessConfigPath),
    database: carrier[databaseCacheKey],
  };
}
