import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import { discoverLead } from "@/features/leads/lead-service";
import { adaptExperiment } from "./adaptation";
import { assignVariant } from "./experiment-service";
import { createInitialMessageExperiment, profile } from "./experiment-test-helpers";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("experiment adaptation", () => {
  it("does not change allocations before every variant reaches minimum sample", () => {
    database = createTestDatabase();
    const experiment = createInitialMessageExperiment(database);
    seedAssignedLeads(database, experiment.experimentId, 1);

    const result = adaptExperiment(database, experiment.experimentId);

    expect(result).toEqual({ changed: false, reason: "minimum_sample_not_reached" });
  });

  it("promotes the better variant gradually and records a rollback allocation", () => {
    database = createTestDatabase();
    const experiment = createInitialMessageExperiment(database);
    const assignments = seedBalancedAssignments(database, experiment.experimentId, 2);
    for (const leadId of assignments.challengerLeadIds) recordOutcome(database, leadId, "active_customer");
    for (const leadId of assignments.controlLeadIds) recordOutcome(database, leadId, "replied");

    const result = adaptExperiment(database, experiment.experimentId);
    const allocations = readAllocations(database, experiment.experimentId);
    const audit = database.sqlite
      .prepare("SELECT before_json, after_json FROM audit_logs WHERE action = 'experiment_adapted'")
      .get() as { before_json: string; after_json: string };

    expect(result.changed).toBe(true);
    expect(result.rollbackAllocation).toEqual(Object.fromEntries(Object.entries(allocations).map(([id, value]) => [id, value + (id === result.winnerVariantId ? -1_000 : 1_000)])));
    expect(allocations[result.winnerVariantId!]).toBe(6_000);
    expect(Math.min(...Object.values(allocations))).toBeGreaterThanOrEqual(1_000);
    expect(JSON.parse(audit.before_json)).toEqual(result.rollbackAllocation);
    expect(JSON.parse(audit.after_json)).toEqual(allocations);
  });
});

function seedAssignedLeads(db: AppDatabase, experimentId: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const lead = discoverLead(db, profile(`@sample.${index}`));
    assignVariant(db, experimentId, lead.leadId);
  }
}

function seedBalancedAssignments(db: AppDatabase, experimentId: string, countPerVariant: number) {
  const variants = db.sqlite
    .prepare("SELECT id, is_control FROM experiment_variants WHERE experiment_id = ? ORDER BY is_control DESC")
    .all(experimentId) as Array<{ id: string; is_control: number }>;
  const controlLeadIds: string[] = [];
  const challengerLeadIds: string[] = [];

  for (const variant of variants) {
    for (let index = 0; index < countPerVariant; index += 1) {
      const lead = discoverLead(db, profile(`@${variant.is_control ? "control" : "challenger"}.${index}`));
      db.sqlite
        .prepare(`
          INSERT INTO experiment_assignments (experiment_id, variant_id, lead_id, assigned_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(experimentId, variant.id, lead.leadId, "2026-08-28T12:00:00.000Z");
      (variant.is_control ? controlLeadIds : challengerLeadIds).push(lead.leadId);
    }
  }
  return { controlLeadIds, challengerLeadIds };
}

function recordOutcome(db: AppDatabase, leadId: string, pipelineState: string): void {
  db.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, 'funnel.outcome', ?, 'adaptation-test', '2026-08-28T12:10:00.000Z')
    `)
    .run(randomUUID(), leadId, JSON.stringify({ pipelineState }));
}

function readAllocations(db: AppDatabase, experimentId: string): Record<string, number> {
  const rows = db.sqlite
    .prepare("SELECT id, allocation_basis_points FROM experiment_variants WHERE experiment_id = ?")
    .all(experimentId) as Array<{ id: string; allocation_basis_points: number }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.allocation_basis_points]));
}
