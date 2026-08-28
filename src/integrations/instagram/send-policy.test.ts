import { afterEach, describe, expect, it } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import { discoverLead } from "@/features/leads/lead-service";

import { evaluateInstagramSendPolicy } from "./send-policy";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("Instagram API send policy", () => {
  it("allows a healthy API-owned conversation inside the 24-hour window", () => {
    database = createTestDatabase();
    const leadId = seedApiEligibleLead(database, "@policy.allowed");

    expect(
      evaluateInstagramSendPolicy(database, leadId, new Date("2026-08-28T17:00:00.000Z")),
    ).toEqual({
      allowed: true,
      conversationId: `conversation:${leadId}`,
      recipientId: "meta-policy-1",
      windowExpiresAt: "2026-08-29T16:00:00.000Z",
    });
  });

  it("blocks a conversation at or after the 24-hour boundary", () => {
    database = createTestDatabase();
    const leadId = seedApiEligibleLead(database, "@policy.expired");

    expect(
      evaluateInstagramSendPolicy(database, leadId, new Date("2026-08-29T16:00:00.000Z")),
    ).toEqual({ allowed: false, reason: "api_window_expired" });
  });

  it("gives do-not-contact precedence over every delivery condition", () => {
    database = createTestDatabase();
    const leadId = seedApiEligibleLead(database, "@policy.stop");
    database.sqlite
      .prepare(`
        INSERT INTO do_not_contact (normalized_handle, lead_id, source, reason, created_at)
        VALUES ('policy.stop', ?, 'webhook', 'Pediu para parar', ?)
      `)
      .run(leadId, "2026-08-28T16:30:00.000Z");

    expect(
      evaluateInstagramSendPolicy(database, leadId, new Date("2026-08-28T17:00:00.000Z")),
    ).toEqual({ allowed: false, reason: "do_not_contact" });
  });
});

export function seedApiEligibleLead(db: AppDatabase, instagramHandle: string): string {
  const lead = discoverLead(db, {
    instagramHandle,
    displayName: "Lead API",
    bio: "Marca de suplemento",
    category: "Empreendedor",
    location: "Brasil",
    recentPosts: [],
    hashtags: [],
    relatedProfiles: [],
    source: "policy-test",
    proposedFunnel: "customer",
  });
  const leadId = lead.leadId;
  const inboundAt = "2026-08-28T16:00:00.000Z";
  db.sqlite.transaction(() => {
    db.sqlite
      .prepare(`
        UPDATE leads
        SET pipeline_state = 'replied', channel_state = 'api_eligible', channel_owner = 'api'
        WHERE id = ?
      `)
      .run(leadId);
    db.sqlite
      .prepare(`
        INSERT INTO conversations (
          id, lead_id, owner, meta_recipient_id, last_inbound_at,
          api_window_expires_at, created_at, updated_at
        ) VALUES (?, ?, 'api', 'meta-policy-1', ?, ?, ?, ?)
      `)
      .run(
        `conversation:${leadId}`,
        leadId,
        inboundAt,
        "2026-08-29T16:00:00.000Z",
        inboundAt,
        inboundAt,
      );
    db.sqlite
      .prepare(`
        INSERT INTO messages (
          id, lead_id, conversation_id, direction, channel, body,
          external_id, delivery_state, created_at
        ) VALUES (?, ?, ?, 'inbound', 'instagram_api', 'Tenho interesse', ?, 'received', ?)
      `)
      .run(`inbound:${leadId}`, leadId, `conversation:${leadId}`, `mid:${leadId}`, inboundAt);
    db.sqlite
      .prepare(`
        UPDATE integration_health
        SET status = 'healthy', circuit_state = 'closed'
        WHERE integration = 'instagram'
      `)
      .run();
  })();
  return leadId;
}
