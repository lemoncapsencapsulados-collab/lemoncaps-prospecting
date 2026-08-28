import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import { discoverLead, readLead } from "@/features/leads/lead-service";

import { pollInstagramConversations } from "./conversations-poller";
import { ingestInboundMessage } from "./webhook-service";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

const businessAccountId = "17841454972938381";

function configured(overrides: Record<string, unknown> = {}) {
  return {
    database: database!,
    mode: "live" as const,
    accessToken: "token",
    businessAccountId,
    apiVersion: "v25.0",
    now: () => new Date("2026-08-28T18:00:00.000Z"),
    ...overrides,
  };
}

function graphResponse(messages: readonly Record<string, unknown>[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ id: "conv-1", messages: { data: messages } }] }),
  }) as unknown as typeof fetch;
}

function seedLead(handle: string): string {
  return discoverLead(database!, {
    instagramHandle: handle,
    displayName: "Marca interessada",
    bio: "Marca de suplementos",
    category: "Empreendedor",
    location: "Brasil",
    recentPosts: [],
    hashtags: [],
    relatedProfiles: [],
    source: "poller-test",
    proposedFunnel: "customer",
  }).leadId;
}

describe("inbound polling", () => {
  it("does not call the API while Instagram is simulated", async () => {
    database = createTestDatabase();
    const fetchImpl = graphResponse([]);

    const result = await pollInstagramConversations(configured({ mode: "simulated", fetchImpl }));

    expect(result).toMatchObject({ status: "skipped", reason: "instagram_simulated" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not call the API without credentials", async () => {
    database = createTestDatabase();
    const fetchImpl = graphResponse([]);

    const result = await pollInstagramConversations(configured({ accessToken: undefined, fetchImpl }));

    expect(result).toMatchObject({ status: "skipped", reason: "instagram_not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ingests an inbound message and hands the lead to the API", async () => {
    database = createTestDatabase();
    const leadId = seedLead("@marca.poll");

    const result = await pollInstagramConversations(
      configured({
        fetchImpl: graphResponse([
          {
            id: "mid.poll.1",
            from: { id: "9001", username: "marca.poll" },
            message: "Quero fabricar minha linha",
            created_time: "2026-08-28T17:59:00+0000",
          },
        ]),
      }),
    );

    expect(result).toMatchObject({ status: "polled", accepted: 1, duplicates: 0, unmatched: 0 });
    expect(readLead(database, leadId)).toMatchObject({ channelState: "api_eligible", channelOwner: "api" });

    const stored = database.sqlite
      .prepare("SELECT body, direction, external_id FROM messages WHERE lead_id = ?")
      .all(leadId);
    expect(stored).toEqual([
      { body: "Quero fabricar minha linha", direction: "inbound", external_id: "mid.poll.1" },
    ]);
  });

  it("ignores messages the business account itself sent", async () => {
    database = createTestDatabase();
    seedLead("@marca.poll");

    const result = await pollInstagramConversations(
      configured({
        fetchImpl: graphResponse([
          { id: "mid.echo", from: { id: businessAccountId }, message: "Resposta nossa" },
        ]),
      }),
    );

    expect(result).toMatchObject({ accepted: 0, ignored: 1 });
  });

  it("ignores an empty or media-only message", async () => {
    database = createTestDatabase();
    seedLead("@marca.poll");

    const result = await pollInstagramConversations(
      configured({
        fetchImpl: graphResponse([{ id: "mid.media", from: { id: "9001", username: "marca.poll" } }]),
      }),
    );

    expect(result).toMatchObject({ accepted: 0, ignored: 1 });
  });

  it("skips a message the webhook already handled, so the two paths cannot double up", async () => {
    database = createTestDatabase();
    seedLead("@marca.poll");

    // The webhook gets there first.
    ingestInboundMessage(
      database,
      {
        externalId: "mid.shared",
        senderId: "9001",
        senderUsername: "marca.poll",
        text: "Chegou pelo webhook",
        timestamp: new Date("2026-08-28T17:58:00.000Z"),
        source: "webhook",
        payloadHash: "hash",
      },
      new Date("2026-08-28T17:58:00.000Z"),
    );

    const result = await pollInstagramConversations(
      configured({
        fetchImpl: graphResponse([
          { id: "mid.shared", from: { id: "9001", username: "marca.poll" }, message: "Chegou pelo webhook" },
        ]),
      }),
    );

    expect(result).toMatchObject({ accepted: 0, duplicates: 1 });
    const count = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE external_id = 'mid.shared'")
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  it("opens the circuit and rethrows when the API rejects the request", async () => {
    database = createTestDatabase();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Invalid OAuth access token" } }),
    }) as unknown as typeof fetch;

    await expect(pollInstagramConversations(configured({ fetchImpl }))).rejects.toThrow(
      "Invalid OAuth access token",
    );

    const health = database.sqlite
      .prepare("SELECT consecutive_failures FROM integration_health WHERE integration = 'instagram'")
      .get() as { consecutive_failures: number } | undefined;
    expect(health?.consecutive_failures).toBeGreaterThan(0);
  });

  it("records an exception when the sender matches no lead", async () => {
    database = createTestDatabase();

    const result = await pollInstagramConversations(
      configured({
        fetchImpl: graphResponse([
          { id: "mid.unknown", from: { id: "9999", username: "desconhecido" }, message: "Oi" },
        ]),
      }),
    );

    expect(result).toMatchObject({ unmatched: 1 });
    const exception = database.sqlite
      .prepare("SELECT type, status FROM exceptions WHERE type = 'instagram_sender_unmatched'")
      .get();
    expect(exception).toMatchObject({ status: "open" });
  });
});
