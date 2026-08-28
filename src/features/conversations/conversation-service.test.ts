import { afterEach, describe, expect, it } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import { discoverLead, readLead } from "@/features/leads/lead-service";
import { loadBusinessConfig } from "@/lib/business-config";
import type { ConversationDecision } from "@/integrations/openai/decision-schema";
import type { DecisionModel, ModelDecisionResult } from "@/integrations/openai/client";

import { handleInboundConversation } from "./conversation-service";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("inbound conversation orchestration", () => {
  it("handles opt-out deterministically without calling a model", async () => {
    database = createTestDatabase();
    const fixture = seedInbound(database, "@conversation.stop", "pare de mandar mensagem");
    const model = new FakeDecisionModel([]);

    const result = await handleInboundConversation(
      dependencies(database, model),
      command(fixture.leadId, fixture.messageId),
    );

    expect(result).toEqual({ status: "opted_out" });
    expect(model.calls).toHaveLength(0);
    expect(readLead(database, fixture.leadId)).toMatchObject({
      channelState: "do_not_contact",
      channelOwner: "none",
    });
  });

  it("uses fast triage then the main model and queues a policy-approved API reply", async () => {
    database = createTestDatabase();
    const fixture = seedInbound(database, "@conversation.reply", "Como funciona?");
    const model = new FakeDecisionModel([
      modelResult(decision({ intent: "asked_info", action: "respond", responseText: "Rascunho" })),
      modelResult(
        decision({
          intent: "asked_info",
          action: "respond",
          responseText: "Somos uma empresa brasileira.",
        }),
      ),
    ]);

    const result = await handleInboundConversation(
      dependencies(database, model),
      command(fixture.leadId, fixture.messageId),
    );

    expect(result).toEqual({ status: "reply_queued", action: "respond" });
    expect(model.calls.map((call) => call.purpose)).toEqual(["intent", "response"]);
    expect(model.calls.map((call) => call.model)).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"]);
    expect(
      database.sqlite.prepare("SELECT type, payload_json FROM jobs").get(),
    ).toMatchObject({ type: "send_api_response" });
    expect(JSON.parse((database.sqlite.prepare("SELECT payload_json FROM jobs").get() as { payload_json: string }).payload_json)).toMatchObject({
      leadId: fixture.leadId,
      text: "Somos uma empresa brasileira.",
    });
    expect(count(database, "ai_calls")).toBe(2);
    expect(countWhere(database, "events", "type = 'ai.decision'")).toBe(1);
  });

  it("sends a rejected model claim to human review without auto-rewriting it", async () => {
    database = createTestDatabase();
    const fixture = seedInbound(database, "@conversation.claim", "Tem garantia de resultado?");
    const model = new FakeDecisionModel([
      modelResult(decision({ intent: "asked_info", action: "respond", responseText: "Rascunho" })),
      modelResult(
        decision({
          intent: "asked_info",
          action: "respond",
          responseText: "Você terá 100% de resultado garantido.",
        }),
      ),
    ]);

    const result = await handleInboundConversation(
      dependencies(database, model),
      command(fixture.leadId, fixture.messageId),
    );

    expect(result).toEqual({ status: "human_review", reason: "unverified_claim" });
    expect(readLead(database, fixture.leadId)).toMatchObject({
      channelState: "human_review_required",
      channelOwner: "human",
    });
    expect(count(database, "jobs")).toBe(0);
    expect(count(database, "exceptions")).toBe(1);
  });
});

class FakeDecisionModel implements DecisionModel {
  readonly calls: Array<{ model: string; purpose: "intent" | "response" }> = [];

  constructor(private readonly results: readonly ModelDecisionResult[]) {}

  async decide(input: Parameters<DecisionModel["decide"]>[0]): Promise<ModelDecisionResult> {
    this.calls.push({ model: input.model, purpose: input.purpose });
    const result = this.results[this.calls.length - 1];
    if (!result) throw new Error("No fake model result configured");
    return result;
  }
}

function dependencies(db: AppDatabase, model: DecisionModel) {
  return {
    database: db,
    business: loadBusinessConfig("src/test/fixtures/business.json"),
    model,
    fastModel: "gpt-5.6-luna",
    mainModel: "gpt-5.6-sol",
    monthlyBudgetUsd: 25,
    pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
    projectedCallCostUsd: 0.01,
    now: () => new Date("2026-08-28T17:00:00.000Z"),
  };
}

function command(leadId: string, messageId: string) {
  return { leadId, messageId, correlationId: `interpret:${messageId}` };
}

function decision(overrides: Partial<ConversationDecision> = {}): ConversationDecision {
  return {
    intent: "ambiguous",
    action: "wait",
    responseText: null,
    confidence: 0.8,
    reasoningSummary: "Resumo seguro.",
    followUpAt: null,
    escalationReason: null,
    ...overrides,
  };
}

function modelResult(value: ConversationDecision): ModelDecisionResult {
  return {
    decision: value,
    model: "model-used",
    inputTokens: 100,
    outputTokens: 50,
  };
}

function seedInbound(db: AppDatabase, handle: string, text: string) {
  const lead = discoverLead(db, {
    instagramHandle: handle,
    displayName: "Lead de conversa",
    bio: "Marca de saúde",
    category: "Empreendedor",
    location: "Brasil",
    recentPosts: [],
    hashtags: [],
    relatedProfiles: [],
    source: "conversation-test",
    proposedFunnel: "customer",
  });
  const inboundAt = "2026-08-28T16:00:00.000Z";
  const conversationId = `conversation:${lead.leadId}`;
  const messageId = `mid:${lead.leadId}`;
  db.sqlite.transaction(() => {
    db.sqlite
      .prepare(`
        UPDATE leads
        SET pipeline_state = 'replied', channel_state = 'api_eligible', channel_owner = 'api'
        WHERE id = ?
      `)
      .run(lead.leadId);
    db.sqlite
      .prepare(`
        INSERT INTO conversations (
          id, lead_id, owner, meta_recipient_id, last_inbound_at,
          api_window_expires_at, created_at, updated_at
        ) VALUES (?, ?, 'api', ?, ?, ?, ?, ?)
      `)
      .run(
        conversationId,
        lead.leadId,
        `meta:${lead.leadId}`,
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
        ) VALUES (?, ?, ?, 'inbound', 'instagram_api', ?, ?, 'received', ?)
      `)
      .run(messageId, lead.leadId, conversationId, text, messageId, inboundAt);
    db.sqlite
      .prepare(`
        UPDATE integration_health
        SET status = 'healthy', circuit_state = 'closed'
        WHERE integration = 'instagram'
      `)
      .run();
  })();
  return { leadId: lead.leadId, messageId };
}

function count(db: AppDatabase, table: string): number {
  return (db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function countWhere(db: AppDatabase, table: string, condition: string): number {
  return (db.sqlite
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`)
    .get() as { count: number }).count;
}
