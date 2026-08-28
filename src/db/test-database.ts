import { createDatabase, type AppDatabase } from "./client.ts";
import { migrateDatabase } from "./migrate.ts";

export function createTestDatabase(): AppDatabase {
  const database = createDatabase(":memory:");
  migrateDatabase(database);
  return database;
}
