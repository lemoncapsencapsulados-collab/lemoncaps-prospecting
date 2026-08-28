import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import { optOutLead } from "./do-not-contact";
import { discoverLead, readLead } from "./lead-service";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("do not contact", () => {
  it("permanently suppresses rediscovery and cancels pending contact work", () => {
    database = createTestDatabase();
    const discovered = discoverLead(database, profile("@stop.now"));
    seedPendingJob(database, discovered.leadId);

    optOutLead(database, {
      leadId: discovered.leadId,
      source: "instagram_inbound",
      reason: "pare de mandar mensagem",
      correlationId: "opt-out-1",
    });
    const rediscovered = discoverLead(database, profile("STOP.NOW"));
    const remainingJobs = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued', 'running')")
      .get() as { count: number };

    expect(readLead(database, discovered.leadId).channelState).toBe("do_not_contact");
    expect(rediscovered).toEqual({ leadId: discovered.leadId, created: false, suppressed: true });
    expect(remainingJobs.count).toBe(0);
  });
});

function profile(instagramHandle: string) {
  return {
    instagramHandle,
    displayName: "Perfil",
    bio: "Conteúdo público",
    category: "Criador",
    location: "Brasil",
    recentPosts: [],
    hashtags: [],
    relatedProfiles: [],
    source: "manual",
    proposedFunnel: "affiliate" as const,
  };
}

function seedPendingJob(db: AppDatabase, leadId: string): void {
  const timestamp = "2026-08-28T12:00:00.000Z";
  db.sqlite
    .prepare(`
      INSERT INTO jobs (
        id, type, payload_json, status, attempts, max_attempts, run_at,
        idempotency_key, correlation_id, created_at, updated_at
      ) VALUES (?, 'send_browser_contact', ?, 'queued', 0, 3, ?, ?, ?, ?, ?)
    `)
    .run(
      "job-contact",
      JSON.stringify({ leadId }),
      timestamp,
      `contact:${leadId}`,
      "opt-out-1",
      timestamp,
      timestamp,
    );
}
