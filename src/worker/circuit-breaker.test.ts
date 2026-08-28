import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import { isCircuitOpen, recordIntegrationFailure, recordIntegrationSuccess } from "./circuit-breaker";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("integration circuit breaker", () => {
  it("opens at the failure threshold and creates one operator exception", () => {
    database = createTestDatabase();
    const now = new Date("2026-08-28T12:00:00.000Z");

    recordIntegrationFailure(database, "browser", "session_lost", now, 3);
    recordIntegrationFailure(database, "browser", "session_lost", now, 3);
    expect(isCircuitOpen(database, "browser")).toBe(false);
    recordIntegrationFailure(database, "browser", "session_lost", now, 3);

    expect(isCircuitOpen(database, "browser")).toBe(true);
    expect(
      (database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM exceptions WHERE type = 'browser_circuit_open'")
        .get() as { count: number }).count,
    ).toBe(1);
  });

  it("closes and resets the circuit after a successful health check", () => {
    database = createTestDatabase();
    const now = new Date("2026-08-28T12:00:00.000Z");
    recordIntegrationFailure(database, "instagram", "request_failed", now, 1);

    recordIntegrationSuccess(database, "instagram", new Date("2026-08-28T12:01:00.000Z"));

    expect(isCircuitOpen(database, "instagram")).toBe(false);
  });
});
