import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createVerifiedBackup } from "./backup";
import { createDatabase } from "./client";
import { migrateDatabase } from "./migrate";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite database", () => {
  it("enables foreign keys, WAL, and a five-second busy timeout", () => {
    const database = createMigratedTemporaryDatabase();

    expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.sqlite.pragma("busy_timeout", { simple: true })).toBe(5_000);

    database.close();
  });

  it("enforces one normalized Instagram handle across funnels", () => {
    const database = createMigratedTemporaryDatabase();
    const insert = database.sqlite.prepare(`
      INSERT INTO leads (
        id, instagram_handle, normalized_handle, funnel, pipeline_state,
        channel_state, channel_owner, public_profile_json, score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const timestamp = "2026-08-28T12:00:00.000Z";

    insert.run(
      "lead-1",
      "@Example",
      "example",
      "customer",
      "discovered",
      "browser_contact_pending",
      "browser",
      "{}",
      0,
      timestamp,
      timestamp,
    );

    expect(() =>
      insert.run(
        "lead-2",
        "example",
        "example",
        "affiliate",
        "discovered",
        "browser_contact_pending",
        "browser",
        "{}",
        0,
        timestamp,
        timestamp,
      ),
    ).toThrow(/UNIQUE constraint failed: leads\.normalized_handle/);

    database.close();
  });

  it("prevents duplicate outbound messages by idempotency key", () => {
    const database = createMigratedTemporaryDatabase();
    seedLead(database.sqlite);
    const insert = database.sqlite.prepare(`
      INSERT INTO messages (
        id, lead_id, direction, channel, body, delivery_state,
        idempotency_key, created_at
      ) VALUES (?, ?, 'outbound', 'browser', ?, 'sent', ?, ?)
    `);

    insert.run("message-1", "lead-1", "Olá", "browser:first:lead-1", "2026-08-28T12:00:00.000Z");

    expect(() =>
      insert.run("message-2", "lead-1", "Olá de novo", "browser:first:lead-1", "2026-08-28T12:01:00.000Z"),
    ).toThrow(/UNIQUE constraint failed: messages\.idempotency_key/);

    database.close();
  });

  it("creates a readable backup containing committed records", async () => {
    const directory = createTemporaryDirectory();
    const database = createDatabase(join(directory, "source.db"));
    migrateDatabase(database);
    seedLead(database.sqlite);

    const result = await createVerifiedBackup(database, join(directory, "backups", "source.db"));
    const backup = createDatabase(result.path, { readonly: true });
    const row = backup.sqlite.prepare("SELECT normalized_handle FROM leads WHERE id = ?").get("lead-1") as
      | { normalized_handle: string }
      | undefined;

    expect(result.integrityCheck).toBe("ok");
    expect(row?.normalized_handle).toBe("example");

    backup.close();
    database.close();
  });

  it("applies the versioned migration only once", () => {
    const database = createMigratedTemporaryDatabase();

    migrateDatabase(database);

    const migrationCount = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number };
    expect(migrationCount.count).toBe(1);

    database.close();
  });
});

function createMigratedTemporaryDatabase() {
  const database = createDatabase(join(createTemporaryDirectory(), "prospecting.db"));
  migrateDatabase(database);
  return database;
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "prospecting-db-"));
  temporaryDirectories.push(directory);
  return directory;
}

function seedLead(sqlite: import("better-sqlite3").Database): void {
  sqlite
    .prepare(`
      INSERT INTO leads (
        id, instagram_handle, normalized_handle, funnel, pipeline_state,
        channel_state, channel_owner, public_profile_json, score, created_at, updated_at
      ) VALUES (?, ?, ?, 'customer', 'discovered', 'browser_contact_pending', 'browser', '{}', 0, ?, ?)
    `)
    .run(
      "lead-1",
      "@Example",
      "example",
      "2026-08-28T12:00:00.000Z",
      "2026-08-28T12:00:00.000Z",
    );
}
