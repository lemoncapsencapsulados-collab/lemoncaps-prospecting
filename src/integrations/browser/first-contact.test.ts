import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import { discoverLead, qualifyLead, readLead } from "@/features/leads/lead-service";
import { loadBusinessConfig } from "@/lib/business-config";
import { isCircuitOpen } from "@/worker/circuit-breaker";
import { FakeBrowserClient } from "./fake-browser-client";
import { sendFirstContact } from "./first-contact";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("browser first contact", () => {
  it("uses a dedicated page, records the message, and always closes the page", async () => {
    database = createTestDatabase();
    const leadId = seedQualifiedLead(database, "@browser.success");
    const fake = new FakeBrowserClient();

    const result = await sendFirstContact(dependencies(database, fake), command(leadId));

    expect(result.status).toBe("sent");
    expect(fake.events).toEqual([
      "connect",
      "reuse-context-0",
      "new-page",
      "navigate-instagram",
      "type",
      "send",
      "close-page",
    ]);
    expect(readLead(database, leadId)).toMatchObject({
      pipelineState: "contacted",
      channelState: "waiting_inbound_reply",
      channelOwner: "browser",
    });
    expect(countOutboundMessages(database, leadId)).toBe(1);
  });

  it("blocks the final send and leaves the lead pending in dry-run mode", async () => {
    database = createTestDatabase();
    const leadId = seedQualifiedLead(database, "@browser.dryrun");
    const fake = new FakeBrowserClient();

    const result = await sendFirstContact(
      { ...dependencies(database, fake), mode: "dry_run" },
      command(leadId),
    );

    expect(result.status).toBe("dry_run_blocked");
    expect(fake.events).not.toContain("send");
    expect(fake.events.at(-1)).toBe("close-page");
    expect(readLead(database, leadId).channelState).toBe("browser_contact_pending");
    expect(countOutboundMessages(database, leadId)).toBe(0);
  });

  it("opens the circuit without launching a browser when CDP is unavailable", async () => {
    database = createTestDatabase();
    const leadId = seedQualifiedLead(database, "@browser.unavailable");
    const fake = FakeBrowserClient.unavailable();

    const result = await sendFirstContact(dependencies(database, fake), command(leadId));

    expect(result).toEqual({ status: "failed", reason: "browser_unavailable" });
    expect(fake.events).toEqual(["connect"]);
    expect(isCircuitOpen(database, "browser")).toBe(true);
  });

  it("returns the persisted result without sending a duplicate", async () => {
    database = createTestDatabase();
    const leadId = seedQualifiedLead(database, "@browser.duplicate");
    const fake = new FakeBrowserClient();

    await sendFirstContact(dependencies(database, fake), command(leadId));
    const duplicate = await sendFirstContact(dependencies(database, fake), command(leadId));

    expect(duplicate.status).toBe("already_sent");
    expect(fake.events.filter((event) => event === "send")).toHaveLength(1);
    expect(countOutboundMessages(database, leadId)).toBe(1);
  });

  it("rejects navigation outside Instagram before connecting", async () => {
    database = createTestDatabase();
    const leadId = seedQualifiedLead(database, "@browser.domain");
    const fake = new FakeBrowserClient();

    await expect(
      sendFirstContact(dependencies(database, fake), {
        ...command(leadId),
        profileUrl: "https://example.com/profile",
      }),
    ).rejects.toThrow("Browser navigation is restricted to Instagram");
    expect(fake.events).toEqual([]);
  });
});

function dependencies(db: AppDatabase, client: FakeBrowserClient) {
  return {
    database: db,
    client,
    mode: "simulated" as const,
    workerId: "browser-worker",
    typingDelayMs: 1,
    evaluateLimits: () => ({ allowed: true as const }),
    now: () => new Date("2026-08-28T14:00:00.000Z"),
  };
}

function command(leadId: string) {
  return {
    jobId: `job:${leadId}`,
    leadId,
    profileUrl: "https://www.instagram.com/browser.success/",
    message: "Oi! Vi seu conteúdo sobre marca própria.",
    variantId: "variant-control",
    idempotencyKey: `browser:first:${leadId}`,
  };
}

function seedQualifiedLead(db: AppDatabase, instagramHandle: string): string {
  const lead = discoverLead(db, {
    instagramHandle,
    displayName: "Fundador de Marca",
    bio: "Fundador de negócio com palavra-chave",
    category: "Empreendedor",
    location: "Brasil",
    recentPosts: ["Conteúdo real"],
    hashtags: [],
    relatedProfiles: [],
    source: "browser-test",
    proposedFunnel: "customer",
  });
  qualifyLead(db, lead.leadId, loadBusinessConfig("src/test/fixtures/business.json"), {
    actor: "worker",
    correlationId: `qualify:${lead.leadId}`,
  });
  return lead.leadId;
}

function countOutboundMessages(db: AppDatabase, leadId: string): number {
  return (db.sqlite
    .prepare("SELECT COUNT(*) AS count FROM messages WHERE lead_id = ? AND direction = 'outbound'")
    .get(leadId) as { count: number }).count;
}
