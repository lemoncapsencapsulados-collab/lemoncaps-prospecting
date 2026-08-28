import { afterEach, describe, expect, it } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";

import { assertAiBudgetAvailable, recordAiCall, readMonthlyAiCost } from "./budget";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("OpenAI budget control", () => {
  it("pauses AI work before a call at the monthly budget", () => {
    database = createTestDatabase();
    seedAiCost(database, 10, "2026-08-15T12:00:00.000Z");

    expect(() =>
      assertAiBudgetAvailable(database!, 10, 0, new Date("2026-08-28T12:00:00.000Z")),
    ).toThrow("openai_budget_exhausted");
    expect(readAiPause(database)).toBe(true);
  });

  it("includes projected cost and excludes prior calendar months", () => {
    database = createTestDatabase();
    seedAiCost(database, 20, "2026-07-31T23:59:59.000Z");
    seedAiCost(database, 4, "2026-08-15T12:00:00.000Z");

    expect(readMonthlyAiCost(database, new Date("2026-08-28T12:00:00.000Z"))).toBe(4);
    expect(() =>
      assertAiBudgetAvailable(database!, 5, 1.01, new Date("2026-08-28T12:00:00.000Z")),
    ).toThrow("openai_budget_exhausted");
  });

  it("records token usage with a configurable estimated price", () => {
    database = createTestDatabase();

    const estimatedCostUsd = recordAiCall(database, {
      leadId: null,
      purpose: "intent",
      model: "gpt-5.6-luna",
      inputTokens: 1_000,
      outputTokens: 500,
      pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
      now: new Date("2026-08-28T12:00:00.000Z"),
    });

    expect(estimatedCostUsd).toBeCloseTo(0.006);
    expect(
      database.sqlite.prepare("SELECT * FROM ai_calls").get(),
    ).toMatchObject({
      purpose: "intent",
      model: "gpt-5.6-luna",
      input_tokens: 1_000,
      output_tokens: 500,
      estimated_cost_usd: 0.006,
    });
  });
});

function seedAiCost(db: AppDatabase, cost: number, createdAt: string): void {
  db.sqlite
    .prepare(`
      INSERT INTO ai_calls (
        id, purpose, model, input_tokens, output_tokens, estimated_cost_usd, created_at
      ) VALUES (?, 'test', 'gpt-test-exact', 0, 0, ?, ?)
    `)
    .run(`ai:${createdAt}`, cost, createdAt);
}

function readAiPause(db: AppDatabase): boolean {
  const row = db.sqlite
    .prepare("SELECT value_json FROM system_settings WHERE key = 'ai_pause'")
    .get() as { value_json: string };
  return (JSON.parse(row.value_json) as { paused: boolean }).paused;
}
