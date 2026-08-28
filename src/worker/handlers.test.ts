import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppDatabase } from "@/db/client";
import { createTestDatabase } from "@/db/test-database";
import type { JobRecord, JobType } from "./job-types";

import { createJobHandlers, type JobOperations } from "./handlers";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("typed durable job handlers", () => {
  it("registers every declared job type", () => {
    database = createTestDatabase();
    const handlers = createJobHandlers({ database, operations: operations() });
    const expected: JobType[] = [
      "qualify_lead",
      "prepare_first_contact",
      "send_browser_contact",
      "interpret_inbound",
      "send_api_response",
      "evaluate_follow_up",
      "measure_experiment",
      "adapt_strategy",
      "backup_database",
      "check_integrations",
    ];

    expect(Object.keys(handlers).sort()).toEqual(expected.sort());
  });

  it("validates payloads and executes a replayed job only once", async () => {
    database = createTestDatabase();
    const interpretInbound = vi.fn().mockResolvedValue(undefined);
    const handlers = createJobHandlers({
      database,
      operations: operations({ interpretInbound }),
    });
    const job = record("interpret_inbound", { leadId: "lead-1", messageId: "mid-1" });

    await handlers.interpret_inbound!(job);
    await handlers.interpret_inbound!(job);

    expect(interpretInbound).toHaveBeenCalledOnce();
    expect(interpretInbound).toHaveBeenCalledWith(
      { leadId: "lead-1", messageId: "mid-1" },
      expect.objectContaining({ id: job.id, correlationId: job.correlationId }),
    );
    expect(completedMarkers(database)).toBe(1);
  });

  it("rejects a malformed payload before invoking an operation", async () => {
    database = createTestDatabase();
    const sendApiResponse = vi.fn().mockResolvedValue(undefined);
    const handlers = createJobHandlers({ database, operations: operations({ sendApiResponse }) });

    await expect(
      handlers.send_api_response!(record("send_api_response", { leadId: 123, text: "Oi" })),
    ).rejects.toThrow();
    expect(sendApiResponse).not.toHaveBeenCalled();
  });
});

function operations(overrides: Partial<JobOperations> = {}): JobOperations {
  return {
    qualifyLead: vi.fn(),
    prepareFirstContact: vi.fn(),
    sendBrowserContact: vi.fn(),
    interpretInbound: vi.fn(),
    sendApiResponse: vi.fn(),
    evaluateFollowUp: vi.fn(),
    measureExperiment: vi.fn(),
    adaptStrategy: vi.fn(),
    backupDatabase: vi.fn(),
    checkIntegrations: vi.fn(),
    ...overrides,
  };
}

function record(type: JobType, payload: Readonly<Record<string, unknown>>): JobRecord {
  return {
    id: `job:${type}`,
    type,
    payload,
    status: "running",
    attempts: 0,
    maxAttempts: 3,
    runAt: "2026-08-28T17:00:00.000Z",
    leaseOwner: "worker-test",
    leaseExpiresAt: "2026-08-28T17:01:00.000Z",
    idempotencyKey: `key:${type}`,
    correlationId: `correlation:${type}`,
    lastError: null,
    createdAt: "2026-08-28T17:00:00.000Z",
    updatedAt: "2026-08-28T17:00:00.000Z",
  };
}

function completedMarkers(db: AppDatabase): number {
  return (db.sqlite
    .prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'worker.handler_completed'")
    .get() as { count: number }).count;
}
