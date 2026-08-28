import { afterEach, describe, expect, it } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import { discoverLead, readLead } from "@/features/leads/lead-service";
import { SimulatedBrowserClient } from "@/integrations/browser/simulated-browser-client";
import { SimulatedDecisionModel } from "@/integrations/openai/simulated-decision-model";
import { loadBusinessConfig } from "@/lib/business-config";
import { loadEnv } from "@/lib/env";

import type { JobRecord, JobType } from "./job-types";
import { createRuntimeJobOperations } from "./runtime-operations";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("runtime job operations", () => {
  it("qualifies, prepares, and simulates a first contact without network access", async () => {
    database = createTestDatabase();
    const lead = discoverLead(database, {
      instagramHandle: "@runtime.operations",
      displayName: "Fundador",
      bio: "Fundador com palavra-chave",
      category: "Empreendedor",
      location: "Brasil",
      recentPosts: ["Conteúdo público"],
      hashtags: [],
      relatedProfiles: [],
      source: "runtime-test",
      proposedFunnel: "customer",
    });
    const operations = createRuntimeJobOperations({
      database,
      business: loadBusinessConfig("src/test/fixtures/business.json"),
      env: loadEnv({
        DATABASE_URL: ":memory:",
        OPENAI_MODEL: "gpt-5.6-sol",
        OPENAI_MODEL_FAST: "gpt-5.6-luna",
      }),
      browserClient: new SimulatedBrowserClient(),
      decisionModel: new SimulatedDecisionModel(),
      aiModel: 'gpt-5.6-sol',
      aiModelFast: 'gpt-5.6-luna',
      aiPricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
      projectedAiCallCostUsd: 0,
      workerId: "runtime-worker",
      now: () => new Date("2026-08-28T17:00:00.000Z"),
      random: () => 0,
    });
    const contact = {
      leadId: lead.leadId,
      profileUrl: "https://www.instagram.com/runtime.operations/",
      message: "Oi! Vi seu conteúdo sobre marca própria.",
      variantId: null,
      idempotencyKey: `first:${lead.leadId}`,
    };

    await operations.qualifyLead({ leadId: lead.leadId }, job("qualify_lead"));
    await operations.prepareFirstContact(contact, job("prepare_first_contact"));
    await operations.sendBrowserContact(contact, job("send_browser_contact"));

    expect(readLead(database, lead.leadId)).toMatchObject({
      pipelineState: "contacted",
      channelState: "waiting_inbound_reply",
      channelOwner: "browser",
    });
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE channel = 'browser'")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.sqlite.prepare("SELECT type FROM jobs WHERE type = 'send_browser_contact'").get(),
    ).toEqual({ type: "send_browser_contact" });
  });
});

function job(type: JobType): JobRecord {
  return {
    id: `runtime:${type}`,
    type,
    payload: {},
    status: "running",
    attempts: 0,
    maxAttempts: 3,
    runAt: "2026-08-28T17:00:00.000Z",
    leaseOwner: "runtime-worker",
    leaseExpiresAt: "2026-08-28T17:01:00.000Z",
    idempotencyKey: `runtime-key:${type}`,
    correlationId: `runtime-correlation:${type}`,
    lastError: null,
    createdAt: "2026-08-28T17:00:00.000Z",
    updatedAt: "2026-08-28T17:00:00.000Z",
  };
}
