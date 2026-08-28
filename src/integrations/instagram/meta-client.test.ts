import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import { readLead } from "@/features/leads/lead-service";

import { sendInstagramMessage } from "./meta-client";
import { seedApiEligibleLead } from "./send-policy.test";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("Instagram Send API client", () => {
  it("simulates a durable send and returns it idempotently", async () => {
    database = createTestDatabase();
    const leadId = seedApiEligibleLead(database, "@meta.simulated");
    const dependencies = {
      database,
      mode: "simulated" as const,
      now: () => new Date("2026-08-28T17:00:00.000Z"),
    };

    const first = await sendInstagramMessage(dependencies, command(leadId));
    const duplicate = await sendInstagramMessage(dependencies, command(leadId));

    expect(first).toMatchObject({ status: "sent", mode: "simulated" });
    if (first.status !== "sent") throw new Error("Expected the first simulated message to be sent");
    expect(duplicate).toMatchObject({ status: "already_sent", externalId: first.externalId });
    expect(readLead(database, leadId)).toMatchObject({ channelState: "api_active", channelOwner: "api" });
    expect(outboundCount(database)).toBe(1);
  });

  it("records evidence but never persists or transmits a dry-run message", async () => {
    database = createTestDatabase();
    const leadId = seedApiEligibleLead(database, "@meta.dryrun");
    const fetchSpy = vi.fn<typeof fetch>();

    const result = await sendInstagramMessage(
      {
        database,
        mode: "dry_run",
        fetch: fetchSpy,
        now: () => new Date("2026-08-28T17:00:00.000Z"),
      },
      command(leadId),
    );

    expect(result).toEqual({ status: "dry_run_blocked" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outboundCount(database)).toBe(0);
    expect(readLead(database, leadId).channelState).toBe("api_eligible");
  });

  it("uses the official Graph endpoint in explicitly authorized live mode", async () => {
    database = createTestDatabase();
    const leadId = seedApiEligibleLead(database, "@meta.live");
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message_id: "mid.live.1", recipient_id: "meta-policy-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await sendInstagramMessage(
      {
        database,
        mode: "live",
        liveAuthorized: true,
        accessToken: "secret-token",
        businessAccountId: "business-account",
        apiVersion: "v25.0",
        fetch: fetchSpy,
        now: () => new Date("2026-08-28T17:00:00.000Z"),
      },
      command(leadId),
    );

    expect(result).toEqual({ status: "sent", mode: "live", externalId: "mid.live.1" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://graph.instagram.com/v25.0/business-account/messages");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret-token" });
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: "meta-policy-1" },
      message: { text: "Oi! Como posso ajudar?" },
    });
    expect(outboundCount(database)).toBe(1);
  });

  it("closes an expired API window and creates an operator exception", async () => {
    database = createTestDatabase();
    const leadId = seedApiEligibleLead(database, "@meta.expired");

    const result = await sendInstagramMessage(
      {
        database,
        mode: "simulated",
        now: () => new Date("2026-08-29T16:00:00.000Z"),
      },
      command(leadId),
    );

    expect(result).toEqual({ status: "blocked", reason: "api_window_expired" });
    expect(readLead(database, leadId).channelState).toBe("api_window_closed");
    expect(
      database.sqlite.prepare("SELECT type FROM exceptions WHERE lead_id = ?").get(leadId),
    ).toEqual({ type: "instagram_api_window_expired" });
  });
});

function command(leadId: string) {
  return {
    leadId,
    text: "Oi! Como posso ajudar?",
    idempotencyKey: `api:reply:${leadId}`,
    correlationId: `reply:${leadId}`,
  };
}

function outboundCount(db: AppDatabase): number {
  return (db.sqlite
    .prepare("SELECT COUNT(*) AS count FROM messages WHERE direction = 'outbound'")
    .get() as { count: number }).count;
}
