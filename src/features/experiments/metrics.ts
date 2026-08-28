import type { AppDatabase } from "@/db/client";
import type { Funnel } from "@/features/leads/types";

const customerOutcomeWeights: Readonly<Record<string, number>> = {
  replied: 4,
  interested: 8,
  whatsapp_handoff: 16,
  registered: 32,
  active_customer: 64,
};

const affiliateOutcomeWeights: Readonly<Record<string, number>> = {
  replied: 4,
  interested: 8,
  joined_affiliate_group: 16,
  active_affiliate: 32,
  generated_customer: 64,
};

export interface VariantMetrics {
  readonly variantId: string;
  readonly assignments: number;
  readonly weightedScore: number;
  readonly scorePerAssignment: number;
  readonly outcomeCounts: Readonly<Record<string, number>>;
}

export interface ExperimentReport {
  readonly experimentId: string;
  readonly funnel: Funnel;
  readonly variants: readonly VariantMetrics[];
}

interface AssignmentRow {
  variant_id: string;
  lead_id: string;
}

interface OutcomeRow {
  lead_id: string;
  payload_json: string;
}

export function measureExperiment(database: AppDatabase, experimentId: string): ExperimentReport {
  const experiment = database.sqlite
    .prepare("SELECT funnel FROM experiments WHERE id = ?")
    .get(experimentId) as { funnel: Funnel } | undefined;
  if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);

  const variants = database.sqlite
    .prepare("SELECT id FROM experiment_variants WHERE experiment_id = ? ORDER BY created_at, id")
    .all(experimentId) as Array<{ id: string }>;
  const assignments = database.sqlite
    .prepare("SELECT variant_id, lead_id FROM experiment_assignments WHERE experiment_id = ?")
    .all(experimentId) as AssignmentRow[];
  const outcomes = database.sqlite
    .prepare(`
      SELECT events.lead_id, events.payload_json
      FROM events
      INNER JOIN experiment_assignments ON experiment_assignments.lead_id = events.lead_id
      WHERE experiment_assignments.experiment_id = ? AND events.type = 'funnel.outcome'
    `)
    .all(experimentId) as OutcomeRow[];
  const weights = experiment.funnel === "customer" ? customerOutcomeWeights : affiliateOutcomeWeights;
  const outcomesByLead = collectHighestOutcomes(outcomes, weights);

  return {
    experimentId,
    funnel: experiment.funnel,
    variants: variants.map((variant) => {
      const variantAssignments = assignments.filter((assignment) => assignment.variant_id === variant.id);
      const outcomeCounts: Record<string, number> = {};
      let weightedScore = 0;
      for (const assignment of variantAssignments) {
        const outcome = outcomesByLead.get(assignment.lead_id);
        if (!outcome) continue;
        outcomeCounts[outcome.state] = (outcomeCounts[outcome.state] ?? 0) + 1;
        weightedScore += outcome.weight;
      }
      return {
        variantId: variant.id,
        assignments: variantAssignments.length,
        weightedScore,
        scorePerAssignment: variantAssignments.length === 0 ? 0 : weightedScore / variantAssignments.length,
        outcomeCounts,
      };
    }),
  };
}

function collectHighestOutcomes(
  outcomes: readonly OutcomeRow[],
  weights: Readonly<Record<string, number>>,
): Map<string, { state: string; weight: number }> {
  const result = new Map<string, { state: string; weight: number }>();
  for (const row of outcomes) {
    const payload = JSON.parse(row.payload_json) as { pipelineState?: string };
    const state = payload.pipelineState;
    if (!state) continue;
    const weight = weights[state] ?? 0;
    const current = result.get(row.lead_id);
    if (!current || weight > current.weight) result.set(row.lead_id, { state, weight });
  }
  return result;
}
