import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.ts";

export interface DatabaseOptions {
  readonly readonly?: boolean;
}

export interface AppDatabase {
  readonly sqlite: Database.Database;
  readonly orm: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export function createDatabase(path: string, options: DatabaseOptions = {}): AppDatabase {
  const databasePath = path === ":memory:" ? path : resolve(path);
  if (databasePath !== ":memory:" && !options.readonly) {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath, {
    fileMustExist: options.readonly === true,
    readonly: options.readonly === true,
  });

  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (!options.readonly && databasePath !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }

  return {
    sqlite,
    orm: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}
