import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import type { AppDatabase } from "./client.ts";

const initialMigrationId = "0000_initial";
const initialMigrationPath = fileURLToPath(new URL("./migrations/0000_initial.sql", import.meta.url));

export function migrateDatabase(database: AppDatabase): void {
  database.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = database.sqlite
    .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
    .get(initialMigrationId);
  if (applied) return;

  const migrationSql = readFileSync(initialMigrationPath, "utf8");
  database.sqlite.transaction(() => {
    database.sqlite.exec(migrationSql);
    database.sqlite
      .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run(initialMigrationId, new Date().toISOString());
  })();
}

function runFromCommandLine(): void {
  const databaseUrl = process.env.DATABASE_URL ?? "data/prospecting.db";
  void import("./client.ts").then(({ createDatabase }) => {
    const database = createDatabase(databaseUrl);
    try {
      migrateDatabase(database);
      process.stdout.write(`Database migrated: ${databaseUrl}\n`);
    } finally {
      database.close();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runFromCommandLine();
}
