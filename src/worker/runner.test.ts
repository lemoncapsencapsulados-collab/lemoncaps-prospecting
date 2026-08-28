import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import { enqueueJob, getJob } from "./job-store";
import { runOneJob } from "./runner";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("job runner", () => {
  it("executes a typed handler and persists completion", async () => {
    database = createTestDatabase();
    const timestamp = new Date("2026-08-28T12:00:00.000Z");
    const enqueued = enqueueJob(database, {
      type: "qualify_lead",
      payload: { leadId: "lead-1" },
      idempotencyKey: "qualify:lead-1",
      correlationId: "correlation-1",
      runAt: timestamp,
      maxAttempts: 3,
    });
    const handledLeadIds: string[] = [];

    const result = await runOneJob({
      database,
      workerId: "worker-a",
      now: () => timestamp,
      handlers: {
        qualify_lead: (job) => {
          handledLeadIds.push(String(job.payload.leadId));
        },
      },
    });

    expect(result).toBe("completed");
    expect(handledLeadIds).toEqual(["lead-1"]);
    expect(getJob(database, enqueued.jobId).status).toBe("completed");
  });
});
