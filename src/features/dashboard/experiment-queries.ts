import type { AppDatabase } from "@/db/client";
import type { Funnel } from "@/features/leads/types";
import { measureExperiment, type VariantMetrics } from "@/features/experiments/metrics";

export interface ExperimentVariantView extends VariantMetrics {
  readonly name: string;
  readonly isControl: boolean;
  readonly allocationBasisPoints: number;
  readonly reachedMinimumSample: boolean;
}

export interface ExperimentView {
  readonly id: string;
  readonly name: string;
  readonly funnel: Funnel;
  readonly variable: string;
  readonly status: string;
  readonly minimumSamplePerVariant: number;
  readonly variants: readonly ExperimentVariantView[];
  /** A winner is only meaningful once every variant cleared the minimum sample. */
  readonly conclusive: boolean;
  readonly leadingVariantId: string | null;
}

interface ExperimentRow {
  id: string;
  name: string;
  funnel: Funnel;
  variable: string;
  status: string;
  minimum_sample_per_variant: number;
}

interface VariantRow {
  id: string;
  experiment_id: string;
  name: string;
  is_control: number;
  allocation_basis_points: number;
}

export function readExperiments(database: AppDatabase): readonly ExperimentView[] {
  const experiments = database.sqlite
    .prepare(
      "SELECT id, name, funnel, variable, status, minimum_sample_per_variant FROM experiments ORDER BY created_at DESC",
    )
    .all() as ExperimentRow[];

  return experiments.map((experiment) => toExperimentView(database, experiment));
}

function toExperimentView(database: AppDatabase, experiment: ExperimentRow): ExperimentView {
  const variantRows = database.sqlite
    .prepare(
      "SELECT id, experiment_id, name, is_control, allocation_basis_points FROM experiment_variants WHERE experiment_id = ? ORDER BY is_control DESC, name",
    )
    .all(experiment.id) as VariantRow[];

  const report = measureExperiment(database, experiment.id);
  const metricsById = new Map(report.variants.map((variant) => [variant.variantId, variant]));

  const variants = variantRows.map((row) => {
    const metrics = metricsById.get(row.id);
    const assignments = metrics?.assignments ?? 0;
    return {
      variantId: row.id,
      name: row.name,
      isControl: row.is_control === 1,
      allocationBasisPoints: row.allocation_basis_points,
      assignments,
      weightedScore: metrics?.weightedScore ?? 0,
      scorePerAssignment: metrics?.scorePerAssignment ?? 0,
      outcomeCounts: metrics?.outcomeCounts ?? {},
      reachedMinimumSample: assignments >= experiment.minimum_sample_per_variant,
    } satisfies ExperimentVariantView;
  });

  const conclusive = variants.length > 0 && variants.every((variant) => variant.reachedMinimumSample);
  const leading = variants.reduce<ExperimentVariantView | null>(
    (best, variant) =>
      best === null || variant.scorePerAssignment > best.scorePerAssignment ? variant : best,
    null,
  );

  return {
    id: experiment.id,
    name: experiment.name,
    funnel: experiment.funnel,
    variable: experiment.variable,
    status: experiment.status,
    minimumSamplePerVariant: experiment.minimum_sample_per_variant,
    variants,
    conclusive,
    leadingVariantId: conclusive ? (leading?.variantId ?? null) : null,
  };
}
