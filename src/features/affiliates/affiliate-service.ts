import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";
import { readLead, transitionPipeline } from "@/features/leads/lead-service";
import type { AffiliatePipelineState } from "@/features/leads/types";

export type AffiliateOutcome = "joined_group" | "activated" | "generated_customer";

export interface RecordAffiliateOutcomeInput {
  readonly leadId: string;
  readonly outcome: AffiliateOutcome;
  readonly attributedCustomerId?: string;
  readonly correlationId: string;
}

const outcomeStates: Readonly<Record<AffiliateOutcome, AffiliatePipelineState>> = {
  joined_group: "joined_affiliate_group",
  activated: "active_affiliate",
  generated_customer: "generated_customer",
};

export function recordAffiliateOutcome(
  database: AppDatabase,
  input: RecordAffiliateOutcomeInput,
): void {
  const lead = readLead(database, input.leadId);
  if (lead.funnel !== "affiliate") throw new Error("Affiliate outcome requires an affiliate lead");
  if (input.outcome === "generated_customer" && !input.attributedCustomerId?.trim()) {
    throw new Error("attributedCustomerId is required for generated_customer");
  }

  const nextState = outcomeStates[input.outcome];
  transitionPipeline(database, {
    leadId: input.leadId,
    to: nextState,
    actor: "worker",
    reason: `Recorded affiliate outcome: ${input.outcome}`,
    correlationId: input.correlationId,
  });
  const timestamp = new Date().toISOString();
  database.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, 'funnel.outcome', ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.leadId,
      JSON.stringify({ pipelineState: nextState }),
      input.correlationId,
      timestamp,
    );
  if (input.outcome === "generated_customer") {
    database.sqlite
      .prepare(`
        INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
        VALUES (?, ?, 'affiliate.customer_attributed', ?, ?, ?)
      `)
      .run(
        randomUUID(),
        input.leadId,
        JSON.stringify({ customerLeadId: input.attributedCustomerId }),
        input.correlationId,
        timestamp,
      );
  }
}
