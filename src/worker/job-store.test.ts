import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import {
  acquireSystemMutex,
  completeJob,
  enqueueJob,
  failJob,
  getJob,
  leaseDueJob,
  recoverExpiredLeases,
  releaseSystemMutex,
} from "./job-store";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("durable job store", () => {
  it("deduplicates enqueue by stable idempotency key", () => {
    database = createTestDatabase();
    const input = jobInput("qualify:lead-1");

    const first = enqueueJob(database, input);
    const duplicate = enqueueJob(database, input);

    expect(duplicate).toEqual({ jobId: first.jobId, created: false });
    expect(countJobs(database)).toBe(1);
  });

  it("recovers an expired running lease exactly once after restart", () => {
    database = createTestDatabase();
    const now = new Date("2026-08-28T12:00:00.000Z");
    enqueueJob(database, jobInput("qualify:lead-1"));
    const leased = leaseDueJob(database, "worker-a", now)!;
    database.sqlite
      .prepare("UPDATE jobs SET lease_expires_at = ? WHERE id = ?")
      .run("2026-08-28T11:59:00.000Z", leased.id);

    expect(recoverExpiredLeases(database, now)).toBe(1);
    expect(recoverExpiredLeases(database, now)).toBe(0);
    expect(leaseDueJob(database, "worker-b", now)?.idempotencyKey).toBe("qualify:lead-1");
  });

  it("moves a repeatedly failing job to dead letter at its limit", () => {
    database = createTestDatabase();
    const now = new Date("2026-08-28T12:00:00.000Z");
    const enqueued = enqueueJob(database, { ...jobInput("backup:daily"), maxAttempts: 2 });

    const first = leaseDueJob(database, "worker-a", now)!;
    failJob(database, first, new Error("disk unavailable"), now);
    const second = leaseDueJob(database, "worker-a", new Date("2026-08-28T12:00:03.000Z"))!;
    failJob(database, second, new Error("disk still unavailable"), new Date("2026-08-28T12:00:03.000Z"));

    expect(getJob(database, enqueued.jobId).status).toBe("dead_letter");
    expect(getJob(database, enqueued.jobId).lastError).toBe("disk still unavailable");
  });

  it("allows only one unexpired owner for the browser mutex", () => {
    database = createTestDatabase();
    const now = new Date("2026-08-28T12:00:00.000Z");

    expect(acquireSystemMutex(database, "browser", "worker-a", now, 60)).toBe(true);
    expect(acquireSystemMutex(database, "browser", "worker-b", now, 60)).toBe(false);
    releaseSystemMutex(database, "browser", "worker-a");
    expect(acquireSystemMutex(database, "browser", "worker-b", now, 60)).toBe(true);
  });

  it("completes a leased job and clears its lease", () => {
    database = createTestDatabase();
    const enqueued = enqueueJob(database, jobInput("qualify:lead-2"));
    const leased = leaseDueJob(database, "worker-a", new Date("2026-08-28T12:00:00.000Z"))!;

    completeJob(database, leased.id, new Date("2026-08-28T12:00:01.000Z"));

    expect(getJob(database, enqueued.jobId)).toMatchObject({
      status: "completed",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  });
});

function jobInput(idempotencyKey: string) {
  return {
    type: "qualify_lead" as const,
    payload: { leadId: "lead-1" },
    idempotencyKey,
    correlationId: "correlation-1",
    runAt: new Date("2026-08-28T12:00:00.000Z"),
    maxAttempts: 3,
  };
}

function countJobs(db: AppDatabase): number {
  return (db.sqlite.prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;
}
