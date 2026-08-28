import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import { discoverLead, transitionChannel, transitionPipeline } from "./lead-service";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("lead state machines", () => {
  it("rejects skipping from discovered to active customer", () => {
    database = createTestDatabase();
    const discovered = discoverLead(database, customerProfile("@state.customer"));

    expect(() =>
      transitionPipeline(database!, {
        leadId: discovered.leadId,
        to: "active_customer",
        actor: "worker",
        reason: "invalid skip",
        correlationId: "correlation-invalid",
      }),
    ).toThrow("Invalid customer pipeline transition: discovered -> active_customer");
  });

  it("records valid pipeline and channel transitions in the audit log", () => {
    database = createTestDatabase();
    const discovered = discoverLead(database, customerProfile("@state.audit"));

    transitionPipeline(database, {
      leadId: discovered.leadId,
      to: "qualified",
      actor: "worker",
      reason: "ICP score reached threshold",
      correlationId: "correlation-valid",
    });
    transitionChannel(database, {
      leadId: discovered.leadId,
      to: "browser_contact_sent",
      owner: "browser",
      actor: "worker",
      reason: "First contact persisted",
      correlationId: "correlation-valid",
    });

    const audit = database.sqlite
      .prepare("SELECT action, before_json, after_json FROM audit_logs ORDER BY created_at")
      .all() as Array<{ action: string; before_json: string; after_json: string }>;
    expect(audit.map((entry) => entry.action)).toEqual(["pipeline_transition", "channel_transition"]);
    expect(JSON.parse(audit[0]!.before_json)).toEqual({ pipelineState: "discovered" });
    expect(JSON.parse(audit[1]!.after_json)).toEqual({
      channelOwner: "browser",
      channelState: "browser_contact_sent",
    });
  });
});

function customerProfile(instagramHandle: string) {
  return {
    instagramHandle,
    displayName: "Loja de Saúde",
    bio: "Marca própria de suplementos",
    category: "Saúde e beleza",
    location: "Brasil",
    recentPosts: ["Nossa nova linha"],
    hashtags: ["#suplementos"],
    relatedProfiles: [],
    source: "keyword:marca própria",
    proposedFunnel: "customer" as const,
  };
}
