import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";

import { readGeneralPause } from "./queries.ts";

export interface PauseChange {
  readonly previous: boolean;
  readonly current: boolean;
}

/**
 * Flips the general pause switch and records the change in the audit log.
 * Both writes share one transaction so the panel can never show a pause state
 * that has no accompanying audit trail.
 */
export function setGeneralPause(
  database: AppDatabase,
  paused: boolean,
  reason: string,
  now: Date = new Date(),
): PauseChange {
  const timestamp = now.toISOString();

  return database.sqlite.transaction(() => {
    const previous = readGeneralPause(database);

    database.sqlite
      .prepare(
        "INSERT INTO system_settings (key, value_json, updated_at) VALUES ('general_pause', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      )
      .run(JSON.stringify({ paused }), timestamp);

    database.sqlite
      .prepare(
        "INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, before_json, after_json, reason, correlation_id, created_at) VALUES (?, 'operator', ?, 'system_setting', 'general_pause', ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        paused ? "general_pause.enabled" : "general_pause.disabled",
        JSON.stringify({ paused: previous }),
        JSON.stringify({ paused }),
        reason,
        randomUUID(),
        timestamp,
      );

    return { previous, current: paused };
  })();
}
