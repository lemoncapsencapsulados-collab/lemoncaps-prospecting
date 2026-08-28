import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";

export type IntegrationName = "browser" | "instagram" | "openai";

export function recordIntegrationFailure(
  database: AppDatabase,
  integration: IntegrationName,
  errorCode: string,
  now: Date,
  failureThreshold = 3,
): void {
  database.sqlite.transaction(() => {
    const current = database.sqlite
      .prepare("SELECT consecutive_failures, circuit_state FROM integration_health WHERE integration = ?")
      .get(integration) as { consecutive_failures: number; circuit_state: "closed" | "open" | "half_open" };
    const consecutiveFailures = current.consecutive_failures + 1;
    const opensNow = consecutiveFailures >= failureThreshold;
    database.sqlite
      .prepare(`
        UPDATE integration_health
        SET status = 'unavailable', circuit_state = ?, consecutive_failures = ?,
            last_failure_at = ?, last_error_code = ?, updated_at = ?
        WHERE integration = ?
      `)
      .run(opensNow ? "open" : current.circuit_state, consecutiveFailures, now.toISOString(), errorCode, now.toISOString(), integration);

    if (opensNow && current.circuit_state !== "open") {
      database.sqlite
        .prepare(`
          INSERT INTO exceptions (id, type, severity, status, context_json, created_at)
          VALUES (?, ?, 'critical', 'open', ?, ?)
        `)
        .run(
          randomUUID(),
          `${integration}_circuit_open`,
          JSON.stringify({ integration, errorCode, consecutiveFailures }),
          now.toISOString(),
        );
      database.sqlite
        .prepare(`
          INSERT INTO system_settings (key, value_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
        `)
        .run(
          `${integration}_pause`,
          JSON.stringify({ paused: true, reason: `${integration}_circuit_open` }),
          now.toISOString(),
        );
    }
  })();
}

export function recordIntegrationSuccess(
  database: AppDatabase,
  integration: IntegrationName,
  now: Date,
): void {
  database.sqlite.transaction(() => {
    database.sqlite
      .prepare(`
        UPDATE integration_health
        SET status = 'healthy', circuit_state = 'closed', consecutive_failures = 0,
            last_success_at = ?, last_error_code = NULL, updated_at = ?
        WHERE integration = ?
      `)
      .run(now.toISOString(), now.toISOString(), integration);
    database.sqlite
      .prepare(`
        INSERT INTO system_settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `)
      .run(`${integration}_pause`, JSON.stringify({ paused: false, reason: null }), now.toISOString());
  })();
}

export function isCircuitOpen(database: AppDatabase, integration: IntegrationName): boolean {
  const row = database.sqlite
    .prepare("SELECT circuit_state FROM integration_health WHERE integration = ?")
    .get(integration) as { circuit_state: string };
  return row.circuit_state === "open";
}
