import { afterEach, describe, expect, it } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import { discoverLead, readLead } from "@/features/leads/lead-service";

import { createInstagramSignature } from "./signature";
import {
  InvalidInstagramSignatureError,
  processInstagramWebhook,
  verifyWebhookChallenge,
} from "./webhook-service";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("Instagram webhook service", () => {
  it("answers Meta's verification challenge only for the configured token", () => {
    expect(
      verifyWebhookChallenge(
        { mode: "subscribe", token: "verify-me", challenge: "challenge-123" },
        "verify-me",
      ),
    ).toBe("challenge-123");
    expect(
      verifyWebhookChallenge(
        { mode: "subscribe", token: "wrong", challenge: "challenge-123" },
        "verify-me",
      ),
    ).toBeNull();
  });

  it("rejects an invalid signature before parsing or persisting the body", () => {
    database = createTestDatabase();
    const rawBody = bytes("not-json");

    expect(() =>
      processInstagramWebhook({
        database: database!,
        appSecret: "app-secret",
        signatureHeader: "sha256=invalid",
        rawBody,
      }),
    ).toThrow(InvalidInstagramSignatureError);
    expect(count(database, "webhook_events")).toBe(0);
  });

  it("hands a matched reply to the API atomically and processes duplicates once", () => {
    database = createTestDatabase();
    const leadId = seedWaitingLead(database, "@reply.ready");
    const now = new Date("2026-08-28T16:00:00.000Z");
    const rawBody = bytes(
      JSON.stringify(webhookPayload("mid.reply.1", "17890001", "reply.ready", "Tenho interesse", now)),
    );
    const signatureHeader = createInstagramSignature(rawBody, "app-secret");

    const first = processInstagramWebhook({
      database,
      appSecret: "app-secret",
      signatureHeader,
      rawBody,
      now: () => now,
    });
    const duplicate = processInstagramWebhook({
      database,
      appSecret: "app-secret",
      signatureHeader,
      rawBody,
      now: () => now,
    });

    expect(first).toEqual({ accepted: 1, duplicates: 0, ignored: 0, unmatched: 0 });
    expect(duplicate).toEqual({ accepted: 0, duplicates: 1, ignored: 0, unmatched: 0 });
    expect(readLead(database, leadId)).toMatchObject({
      pipelineState: "replied",
      channelState: "api_eligible",
      channelOwner: "api",
    });
    expect(
      database.sqlite.prepare("SELECT * FROM conversations WHERE lead_id = ?").get(leadId),
    ).toMatchObject({
      owner: "api",
      meta_recipient_id: "17890001",
      last_inbound_at: now.toISOString(),
      api_window_expires_at: "2026-08-29T16:00:00.000Z",
    });
    expect(count(database, "webhook_events")).toBe(1);
    expect(count(database, "messages")).toBe(1);
    expect(count(database, "jobs")).toBe(1);
    expect(count(database, "audit_logs")).toBe(1);
  });

  it("routes an unmatched sender to the exception inbox without guessing a lead", () => {
    database = createTestDatabase();
    const rawBody = bytes(
      JSON.stringify(
        webhookPayload(
          "mid.unknown.1",
          "17899999",
          undefined,
          "Olá",
          new Date("2026-08-28T16:00:00.000Z"),
        ),
      ),
    );

    const result = processInstagramWebhook({
      database,
      appSecret: "app-secret",
      signatureHeader: createInstagramSignature(rawBody, "app-secret"),
      rawBody,
    });

    expect(result).toEqual({ accepted: 0, duplicates: 0, ignored: 0, unmatched: 1 });
    expect(count(database, "exceptions")).toBe(1);
    expect(count(database, "messages")).toBe(0);
    expect(count(database, "jobs")).toBe(0);
  });
});

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function webhookPayload(
  messageId: string,
  senderId: string,
  username: string | undefined,
  text: string,
  timestamp: Date,
) {
  return {
    object: "instagram",
    entry: [
      {
        id: "business-account",
        time: timestamp.getTime(),
        messaging: [
          {
            sender: { id: senderId, ...(username ? { username } : {}) },
            recipient: { id: "business-account" },
            timestamp: timestamp.getTime(),
            message: { mid: messageId, text },
          },
        ],
      },
    ],
  };
}

function seedWaitingLead(db: AppDatabase, instagramHandle: string): string {
  const discovered = discoverLead(db, {
    instagramHandle,
    displayName: "Lead aguardando resposta",
    bio: "Marca de saúde",
    category: "Empreendedor",
    location: "Brasil",
    recentPosts: [],
    hashtags: [],
    relatedProfiles: [],
    source: "webhook-test",
    proposedFunnel: "customer",
  });
  db.sqlite
    .prepare(`
      UPDATE leads
      SET pipeline_state = 'contacted', channel_state = 'waiting_inbound_reply',
          channel_owner = 'browser'
      WHERE id = ?
    `)
    .run(discovered.leadId);
  return discovered.leadId;
}

function count(db: AppDatabase, table: string): number {
  return (db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
