import type { AppDatabase } from "@/db/client";

import { completeJob, failJob, leaseDueJob, recoverExpiredLeases } from "./job-store.ts";
import type { JobHandlerMap } from "./job-types.ts";

export interface RunnerDependencies {
  readonly database: AppDatabase;
  readonly workerId: string;
  readonly handlers: JobHandlerMap;
  readonly now?: () => Date;
}

export type RunJobResult = "idle" | "completed" | "failed";

export async function runOneJob(dependencies: RunnerDependencies): Promise<RunJobResult> {
  const now = dependencies.now ?? (() => new Date());
  recoverExpiredLeases(dependencies.database, now());
  const job = leaseDueJob(dependencies.database, dependencies.workerId, now());
  if (!job) return "idle";

  try {
    const handler = dependencies.handlers[job.type];
    if (!handler) throw new Error(`No handler registered for job type: ${job.type}`);
    await handler(job);
    completeJob(dependencies.database, job.id, now());
    return "completed";
  } catch (error) {
    failJob(dependencies.database, job, toError(error), now());
    return "failed";
  }
}

export async function runUntilIdle(dependencies: RunnerDependencies, maximumJobs = 1_000): Promise<number> {
  let completed = 0;
  for (let index = 0; index < maximumJobs; index += 1) {
    const result = await runOneJob(dependencies);
    if (result === "idle") return completed;
    completed += 1;
  }
  throw new Error(`Worker did not become idle after ${maximumJobs} jobs`);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
