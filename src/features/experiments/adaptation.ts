import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";

import { measureExperiment } from "./metrics.ts";

export interface AdaptationResult {
  readonly changed: boolean;
  readonly reason?: "minimum_sample_not_reached" | "no_better_variant" | "exploration_floor_reached";
  readonly winnerVariantId?: string;
  readonly rollbackAllocation?: Readonly<Record<string, number>>;
}

interface ExperimentRow {
  id: string;
  minimum_sample_per_variant: number;
  status: string;
}

export function adaptExperiment(database: AppDatabase, experimentId: string): AdaptationResult {
  const experiment = database.sqlite
    .prepare("SELECT id, minimum_sample_per_variant, status FROM experiments WHERE id = ?")
    .get(experimentId) as ExperimentRow | undefined;
  if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);
  if (experiment.status !== "running") return { changed: false, reason: "no_better_variant" };

  const report = measureExperiment(database, experimentId);
  if (report.variants.some((variant) => variant.assignments < experiment.minimum_sample_per_variant)) {
    return { changed: false, reason: "minimum_sample_not_reached" };
  }

  const ranked = [...report.variants].sort(
    (left, right) => right.scorePerAssignment - left.scorePerAssignment,
  );
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (!winner || !runnerUp || winner.scorePerAssignment <= runnerUp.scorePerAssignment) {
    return { changed: false, reason: "no_better_variant" };
  }

  const allocations = readAllocations(database, experimentId);
  const donor = Object.entries(allocations)
    .filter(([variantId]) => variantId !== winner.variantId)
    .sort((left, right) => right[1] - left[1])[0];
  if (!donor) return { changed: false, reason: "exploration_floor_reached" };
  const transfer = Math.min(1_000, donor[1] - 1_000);
  if (transfer <= 0) return { changed: false, reason: "exploration_floor_reached" };

  const nextAllocations = {
    ...allocations,
    [winner.variantId]: (allocations[winner.variantId] ?? 0) + transfer,
    [donor[0]]: donor[1] - transfer,
  };
  database.sqlite.transaction(() => {
    const update = database.sqlite.prepare(
      "UPDATE experiment_variants SET allocation_basis_points = ? WHERE id = ? AND experiment_id = ?",
    );
    for (const [variantId, allocation] of Object.entries(nextAllocations)) {
      update.run(allocation, variantId, experimentId);
    }
    const timestamp = new Date().toISOString();
    database.sqlite
      .prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type, entity_id, before_json, after_json,
          reason, correlation_id, created_at
        ) VALUES (?, 'system', 'experiment_adapted', 'experiment', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        experimentId,
        JSON.stringify(allocations),
        JSON.stringify(nextAllocations),
        `Variant ${winner.variantId} achieved the highest weighted outcome score after minimum sample`,
        randomUUID(),
        timestamp,
      );
  })();

  return {
    changed: true,
    winnerVariantId: winner.variantId,
    rollbackAllocation: allocations,
  };
}

function readAllocations(database: AppDatabase, experimentId: string): Record<string, number> {
  const rows = database.sqlite
    .prepare("SELECT id, allocation_basis_points FROM experiment_variants WHERE experiment_id = ?")
    .all(experimentId) as Array<{ id: string; allocation_basis_points: number }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.allocation_basis_points]));
}
