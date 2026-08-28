import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import { discoverLead } from "@/features/leads/lead-service";
import { assignVariant, createExperiment } from "./experiment-service";
import { createInitialMessageExperiment, profile } from "./experiment-test-helpers";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("experiment assignment", () => {
  it("returns the same variant for repeated lead assignment", () => {
    database = createTestDatabase();
    const experiment = createInitialMessageExperiment(database);
    const lead = discoverLead(database, profile("@sticky.assignment"));

    const first = assignVariant(database, experiment.experimentId, lead.leadId);
    const second = assignVariant(database, experiment.experimentId, lead.leadId);
    const count = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM experiment_assignments WHERE experiment_id = ? AND lead_id = ?")
      .get(experiment.experimentId, lead.leadId) as { count: number };

    expect(second).toEqual(first);
    expect(count.count).toBe(1);
  });

  it("rejects variant allocations that do not total ten thousand basis points", () => {
    const currentDatabase = createTestDatabase();
    database = currentDatabase;

    expect(() =>
      createExperiment(currentDatabase, {
        name: "Distribuição inválida",
        funnel: "customer",
        variable: "initial_message",
        minimumSamplePerVariant: 20,
        variants: [
          { name: "Controle", isControl: true, allocationBasisPoints: 5_000, config: { initial_message: "A" } },
          { name: "Variação", isControl: false, allocationBasisPoints: 4_000, config: { initial_message: "B" } },
        ],
      }),
    ).toThrow("Variant allocations must total 10000 basis points");
  });
});
