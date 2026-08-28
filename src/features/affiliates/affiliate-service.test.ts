import { afterEach, describe, expect, it } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import { discoverLead, readLead } from "@/features/leads/lead-service";

import { recordAffiliateOutcome } from "./affiliate-service";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("affiliate outcomes", () => {
  it("progresses the independent affiliate funnel and records customer attribution", () => {
    database = createTestDatabase();
    const leadId = seedInterestedAffiliate(database);

    recordAffiliateOutcome(database, { leadId, outcome: "joined_group", correlationId: "affiliate:join" });
    recordAffiliateOutcome(database, { leadId, outcome: "activated", correlationId: "affiliate:active" });
    recordAffiliateOutcome(database, {
      leadId,
      outcome: "generated_customer",
      attributedCustomerId: "customer-123",
      correlationId: "affiliate:customer",
    });

    expect(readLead(database, leadId).pipelineState).toBe("generated_customer");
    const attribution = database.sqlite
      .prepare("SELECT payload_json FROM events WHERE type = 'affiliate.customer_attributed'")
      .get() as { payload_json: string };
    expect(JSON.parse(attribution.payload_json)).toEqual({ customerLeadId: "customer-123" });
  });

  it("requires an attributed customer for the generated-customer outcome", () => {
    database = createTestDatabase();
    const leadId = seedInterestedAffiliate(database);

    expect(() =>
      recordAffiliateOutcome(database!, {
        leadId,
        outcome: "generated_customer",
        correlationId: "affiliate:missing-customer",
      }),
    ).toThrow("attributedCustomerId");
  });
});

function seedInterestedAffiliate(db: AppDatabase): string {
  const lead = discoverLead(db, {
    instagramHandle: "@affiliate.outcome",
    displayName: "Afiliado",
    bio: "Criador de saúde",
    category: "Criador",
    location: "Brasil",
    recentPosts: [],
    hashtags: [],
    relatedProfiles: [],
    source: "affiliate-test",
    proposedFunnel: "affiliate",
  });
  db.sqlite
    .prepare("UPDATE leads SET pipeline_state = 'interested' WHERE id = ?")
    .run(lead.leadId);
  return lead.leadId;
}
