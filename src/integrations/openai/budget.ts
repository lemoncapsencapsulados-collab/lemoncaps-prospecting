import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";

export interface AiPricing {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
}

export interface RecordAiCallInput {
  readonly leadId: string | null;
  readonly purpose: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricing: AiPricing;
  readonly now: Date;
}

export class AiBudgetExhaustedError extends Error {
  constructor() {
    super("openai_budget_exhausted");
    this.name = "AiBudgetExhaustedError";
  }
}

export function assertAiBudgetAvailable(
  database: AppDatabase,
  monthlyBudgetUsd: number,
  projectedCostUsd = 0,
  now = new Date(),
): void {
  const spent = readMonthlyAiCost(database, now);
  if (spent + projectedCostUsd < monthlyBudgetUsd) return;

  pauseAiForBudget(database, spent, projectedCostUsd, monthlyBudgetUsd, now);
  throw new AiBudgetExhaustedError();
}

export function readMonthlyAiCost(database: AppDatabase, now = new Date()): number {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const row = database.sqlite
    .prepare(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total
      FROM ai_calls
      WHERE created_at >= ? AND created_at < ?
    `)
    .get(start.toISOString(), end.toISOString()) as { total: number };
  return row.total;
}

export function recordAiCall(database: AppDatabase, input: RecordAiCallInput): number {
  assertUsageInput(input);
  const estimatedCostUsd =
    (input.inputTokens / 1_000_000) * input.pricing.inputPerMillionUsd +
    (input.outputTokens / 1_000_000) * input.pricing.outputPerMillionUsd;
  database.sqlite
    .prepare(`
      INSERT INTO ai_calls (
        id, lead_id, purpose, model, input_tokens, output_tokens,
        estimated_cost_usd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.leadId,
      input.purpose,
      input.model,
      input.inputTokens,
      input.outputTokens,
      estimatedCostUsd,
      input.now.toISOString(),
    );
  return estimatedCostUsd;
}

function pauseAiForBudget(
  database: AppDatabase,
  spent: number,
  projected: number,
  budget: number,
  now: Date,
): void {
  database.sqlite.transaction(() => {
    const timestamp = now.toISOString();
    database.sqlite
      .prepare(`
        INSERT INTO system_settings (key, value_json, updated_at)
        VALUES ('ai_pause', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run(
        JSON.stringify({ paused: true, reason: "openai_budget_exhausted", spent, projected, budget }),
        timestamp,
      );
    const existing = database.sqlite
      .prepare("SELECT 1 FROM exceptions WHERE type = 'openai_budget_exhausted' AND status = 'open'")
      .get();
    if (!existing) {
      database.sqlite
        .prepare(`
          INSERT INTO exceptions (id, type, severity, status, context_json, created_at)
          VALUES (?, 'openai_budget_exhausted', 'critical', 'open', ?, ?)
        `)
        .run(randomUUID(), JSON.stringify({ spent, projected, budget }), timestamp);
    }
  })();
}

function assertUsageInput(input: RecordAiCallInput): void {
  const numbers = [
    input.inputTokens,
    input.outputTokens,
    input.pricing.inputPerMillionUsd,
    input.pricing.outputPerMillionUsd,
  ];
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("AI usage and pricing values must be finite non-negative numbers");
  }
}
