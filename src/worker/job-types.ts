export const jobTypes = [
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
] as const;

export type JobType = (typeof jobTypes)[number];
export type JobStatus = "queued" | "running" | "completed" | "dead_letter" | "cancelled";

export interface JobRecord {
  readonly id: string;
  readonly type: JobType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runAt: string;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnqueueJobInput {
  readonly type: JobType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly runAt: Date;
  readonly maxAttempts: number;
}

export type JobHandler = (job: JobRecord) => void | Promise<void>;
export type JobHandlerMap = Partial<Readonly<Record<JobType, JobHandler>>>;
