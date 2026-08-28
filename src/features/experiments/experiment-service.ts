import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";
import type { Funnel } from "@/features/leads/types";

import { chooseWeightedVariant } from "./assignment.ts";

export interface ExperimentVariantInput {
  readonly name: string;
  readonly isControl: boolean;
  readonly allocationBasisPoints: number;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface CreateExperimentInput {
  readonly name: string;
  readonly funnel: Funnel;
  readonly variable: string;
  readonly minimumSamplePerVariant: number;
  readonly variants: readonly ExperimentVariantInput[];
}

export interface CreateExperimentResult {
  readonly experimentId: string;
  readonly variantIds: readonly string[];
}

export interface VariantAssignment {
  readonly experimentId: string;
  readonly variantId: string;
  readonly leadId: string;
  readonly assignedAt: string;
}

export function createExperiment(
  database: AppDatabase,
  input: CreateExperimentInput,
): CreateExperimentResult {
  validateExperiment(input);
  return database.sqlite.transaction(() => {
    const experimentId = randomUUID();
    const timestamp = new Date().toISOString();
    database.sqlite
      .prepare(`
        INSERT INTO experiments (
          id, name, funnel, variable, minimum_sample_per_variant, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
      `)
      .run(
        experimentId,
        input.name,
        input.funnel,
        input.variable,
        input.minimumSamplePerVariant,
        timestamp,
        timestamp,
      );

    const insertVariant = database.sqlite.prepare(`
      INSERT INTO experiment_variants (
        id, experiment_id, name, is_control, allocation_basis_points, config_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const variantIds = input.variants.map((variant) => {
      const variantId = randomUUID();
      insertVariant.run(
        variantId,
        experimentId,
        variant.name,
        variant.isControl ? 1 : 0,
        variant.allocationBasisPoints,
        JSON.stringify(variant.config),
        timestamp,
      );
      return variantId;
    });
    return { experimentId, variantIds };
  })();
}

export function assignVariant(
  database: AppDatabase,
  experimentId: string,
  leadId: string,
): VariantAssignment {
  const existing = readAssignment(database, experimentId, leadId);
  if (existing) return existing;

  return database.sqlite.transaction(() => {
    const concurrent = readAssignment(database, experimentId, leadId);
    if (concurrent) return concurrent;
    const variants = database.sqlite
      .prepare(`
        SELECT id, allocation_basis_points
        FROM experiment_variants
        WHERE experiment_id = ?
        ORDER BY created_at, id
      `)
      .all(experimentId) as Array<{ id: string; allocation_basis_points: number }>;
    if (variants.length < 2) throw new Error(`Experiment requires at least two variants: ${experimentId}`);

    const variantId = chooseWeightedVariant(
      leadId,
      experimentId,
      variants.map((variant) => ({ id: variant.id, allocationBasisPoints: variant.allocation_basis_points })),
    );
    const assignedAt = new Date().toISOString();
    database.sqlite
      .prepare(`
        INSERT INTO experiment_assignments (experiment_id, variant_id, lead_id, assigned_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(experimentId, variantId, leadId, assignedAt);
    return { experimentId, variantId, leadId, assignedAt };
  })();
}

function validateExperiment(input: CreateExperimentInput): void {
  if (input.minimumSamplePerVariant < 1) throw new Error("Minimum sample per variant must be positive");
  if (input.variants.length < 2) throw new Error("Experiment requires at least two variants");
  const total = input.variants.reduce((sum, variant) => sum + variant.allocationBasisPoints, 0);
  if (total !== 10_000) throw new Error("Variant allocations must total 10000 basis points");
  if (input.variants.filter((variant) => variant.isControl).length !== 1) {
    throw new Error("Experiment requires exactly one control variant");
  }
  for (const variant of input.variants) {
    const keys = Object.keys(variant.config);
    if (keys.length !== 1 || keys[0] !== input.variable) {
      throw new Error(`Variant config must change only declared variable: ${input.variable}`);
    }
  }
}

function readAssignment(
  database: AppDatabase,
  experimentId: string,
  leadId: string,
): VariantAssignment | null {
  const row = database.sqlite
    .prepare(`
      SELECT experiment_id, variant_id, lead_id, assigned_at
      FROM experiment_assignments
      WHERE experiment_id = ? AND lead_id = ?
    `)
    .get(experimentId, leadId) as
    | { experiment_id: string; variant_id: string; lead_id: string; assigned_at: string }
    | undefined;
  return row
    ? {
        experimentId: row.experiment_id,
        variantId: row.variant_id,
        leadId: row.lead_id,
        assignedAt: row.assigned_at,
      }
    : null;
}
