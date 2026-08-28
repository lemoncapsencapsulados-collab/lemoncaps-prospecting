import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import type { Funnel, PipelineState } from "@/features/leads/types";

import { setGeneralPause } from "./operations.ts";
import {
  readAiCostSummary,
  readFunnelSummary,
  readGeneralPause,
  readKanban,
  readLeadDetail,
  readOperationSnapshot,
  readOverdueFollowUps,
} from "./queries.ts";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("funnel summary", () => {
  it("lists every stage of the funnel, including the empty ones", () => {
    database = createTestDatabase();
    insertLead(database, { handle: "@a", funnel: "customer", pipelineState: "discovered" });
    insertLead(database, { handle: "@b", funnel: "customer", pipelineState: "discovered" });
    insertLead(database, { handle: "@c", funnel: "customer", pipelineState: "active_customer" });
    insertLead(database, { handle: "@d", funnel: "affiliate", pipelineState: "qualified" });

    const summary = readFunnelSummary(database, "customer");
    const byState = new Map(summary.stages.map((stage) => [stage.state, stage.count]));

    expect(summary.total).toBe(3);
    expect(byState.get("discovered")).toBe(2);
    expect(byState.get("active_customer")).toBe(1);
    expect(byState.get("registered")).toBe(0);
    expect(summary.stages).toHaveLength(9);
  });

  it("keeps the two funnels separate", () => {
    database = createTestDatabase();
    insertLead(database, { handle: "@customer", funnel: "customer", pipelineState: "discovered" });
    insertLead(database, { handle: "@affiliate", funnel: "affiliate", pipelineState: "discovered" });

    expect(readFunnelSummary(database, "customer").total).toBe(1);
    expect(readFunnelSummary(database, "affiliate").total).toBe(1);
  });
});

describe("kanban", () => {
  it("groups leads into their pipeline column ordered by score", () => {
    database = createTestDatabase();
    insertLead(database, { handle: "@low", funnel: "customer", pipelineState: "qualified", score: 20 });
    insertLead(database, { handle: "@high", funnel: "customer", pipelineState: "qualified", score: 90 });

    const columns = readKanban(database, "customer");
    const qualified = columns.find((column) => column.state === "qualified");

    expect(qualified?.total).toBe(2);
    expect(qualified?.cards.map((card) => card.instagramHandle)).toEqual(["@high", "@low"]);
  });
});

describe("general pause", () => {
  it("starts active on a freshly migrated database", () => {
    database = createTestDatabase();

    expect(readGeneralPause(database)).toBe(false);
  });

  it("fails safe to paused when the setting row is missing", () => {
    database = createTestDatabase();
    database.sqlite.prepare("DELETE FROM system_settings WHERE key = 'general_pause'").run();

    expect(readGeneralPause(database)).toBe(true);
  });

  it("fails safe to paused when the stored value cannot be parsed", () => {
    database = createTestDatabase();
    database.sqlite
      .prepare("UPDATE system_settings SET value_json = ? WHERE key = 'general_pause'")
      .run("{not json");

    expect(readGeneralPause(database)).toBe(true);
  });

  it("records an audit entry for every change", () => {
    database = createTestDatabase();

    const change = setGeneralPause(database, true, "Pausa para teste");

    expect(change).toEqual({ previous: false, current: true });
    expect(readGeneralPause(database)).toBe(true);

    const audit = database.sqlite
      .prepare("SELECT actor, action, reason FROM audit_logs WHERE entity_id = 'general_pause'")
      .all() as { actor: string; action: string; reason: string }[];

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: "operator", action: "general_pause.enabled" });
  });

  it("keeps the panel and the worker reading the same fail-safe default", () => {
    database = createTestDatabase();
    setGeneralPause(database, true, "Pausa");
    expect(readGeneralPause(database)).toBe(true);

    setGeneralPause(database, false, "Retomada");
    expect(readGeneralPause(database)).toBe(false);

    const audit = database.sqlite
      .prepare("SELECT action FROM audit_logs WHERE entity_id = 'general_pause' ORDER BY created_at")
      .all() as { action: string }[];

    expect(audit).toHaveLength(2);
  });
});

describe("ai cost summary", () => {
  it("divides the monthly spend by leads and by active customers", () => {
    database = createTestDatabase();
    const now = new Date("2026-08-28T12:00:00.000Z");
    insertLead(database, { handle: "@one", funnel: "customer", pipelineState: "discovered" });
    insertLead(database, { handle: "@two", funnel: "customer", pipelineState: "active_customer" });
    insertAiCall(database, 0.5, "2026-08-10T10:00:00.000Z");
    insertAiCall(database, 0.25, "2026-08-20T10:00:00.000Z");
    insertAiCall(database, 9.99, "2026-07-31T10:00:00.000Z");

    const summary = readAiCostSummary(database, 25, now);

    expect(summary.monthlySpendUsd).toBeCloseTo(0.75);
    expect(summary.callCount).toBe(2);
    expect(summary.costPerLeadUsd).toBeCloseTo(0.375);
    expect(summary.costPerActiveCustomerUsd).toBeCloseTo(0.75);
    expect(summary.budgetUsedRatio).toBeCloseTo(0.03);
  });

  it("returns null instead of dividing by zero", () => {
    database = createTestDatabase();

    const summary = readAiCostSummary(database, 25, new Date());

    expect(summary.costPerLeadUsd).toBeNull();
    expect(summary.costPerActiveCustomerUsd).toBeNull();
  });
});

describe("operations snapshot", () => {
  it("counts only follow-ups already due", () => {
    database = createTestDatabase();
    const now = new Date("2026-08-28T12:00:00.000Z");
    insertLead(database, {
      handle: "@overdue",
      funnel: "customer",
      pipelineState: "replied",
      nextActionAt: "2026-08-27T12:00:00.000Z",
    });
    insertLead(database, {
      handle: "@future",
      funnel: "customer",
      pipelineState: "replied",
      nextActionAt: "2026-08-29T12:00:00.000Z",
    });

    const snapshot = readOperationSnapshot(database, now);
    const overdue = readOverdueFollowUps(database, now);

    expect(snapshot.overdueFollowUps).toBe(1);
    expect(overdue.map((item) => item.instagramHandle)).toEqual(["@overdue"]);
  });
});

describe("lead detail", () => {
  it("returns null for an unknown lead", () => {
    database = createTestDatabase();

    expect(readLeadDetail(database, "missing")).toBeNull();
  });

  it("merges messages, events and audit entries into one timeline, newest first", () => {
    database = createTestDatabase();
    const leadId = insertLead(database, {
      handle: "@timeline",
      funnel: "customer",
      pipelineState: "replied",
    });

    database.sqlite
      .prepare(
        "INSERT INTO messages (id, lead_id, direction, channel, body, delivery_state, created_at) VALUES (?, ?, 'outbound', 'simulated', 'Olá', 'sent', '2026-08-01T10:00:00.000Z')",
      )
      .run(randomUUID(), leadId);
    database.sqlite
      .prepare(
        "INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at) VALUES (?, ?, 'lead.qualified', '{}', 'c1', '2026-08-02T10:00:00.000Z')",
      )
      .run(randomUUID(), leadId);
    database.sqlite
      .prepare(
        "INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, reason, correlation_id, created_at) VALUES (?, 'operator', 'lead.reviewed', 'lead', ?, 'Revisão manual', 'c2', '2026-08-03T10:00:00.000Z')",
      )
      .run(randomUUID(), leadId);

    const detail = readLeadDetail(database, leadId);

    expect(detail?.timeline.map((entry) => entry.kind)).toEqual(["audit", "event", "message"]);
  });
});

interface LeadSeed {
  readonly handle: string;
  readonly funnel: Funnel;
  readonly pipelineState: PipelineState;
  readonly score?: number;
  readonly nextActionAt?: string;
}

function insertLead(database: AppDatabase, seed: LeadSeed): string {
  const id = randomUUID();
  const timestamp = "2026-08-01T00:00:00.000Z";
  database.sqlite
    .prepare(
      "INSERT INTO leads (id, instagram_handle, normalized_handle, funnel, pipeline_state, channel_state, channel_owner, public_profile_json, score, next_action_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'browser_contact_pending', 'none', '{}', ?, ?, ?, ?)",
    )
    .run(
      id,
      seed.handle,
      seed.handle.replace(/^@/, "").toLowerCase(),
      seed.funnel,
      seed.pipelineState,
      seed.score ?? 0,
      seed.nextActionAt ?? null,
      timestamp,
      timestamp,
    );
  return id;
}

function insertAiCall(database: AppDatabase, costUsd: number, createdAt: string): void {
  database.sqlite
    .prepare(
      "INSERT INTO ai_calls (id, purpose, model, input_tokens, output_tokens, estimated_cost_usd, created_at) VALUES (?, 'reply', 'gpt-test', 100, 50, ?, ?)",
    )
    .run(randomUUID(), costUsd, createdAt);
}
