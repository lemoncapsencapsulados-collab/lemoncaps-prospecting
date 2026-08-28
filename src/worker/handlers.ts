import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AppDatabase } from "@/db/client";

import type { JobHandlerMap, JobRecord, JobType } from "./job-types.ts";

const leadId = z.string().trim().min(1);
const correlationText = z.string().trim().min(1);

const payloadSchemas = {
  qualify_lead: z.object({ leadId }).strict(),
  prepare_first_contact: z
    .object({
      leadId,
      profileUrl: z.url(),
      message: z.string().trim().min(1).max(1_000),
      variantId: z.string().nullable().default(null),
      idempotencyKey: correlationText,
    })
    .strict(),
  send_browser_contact: z
    .object({
      leadId,
      profileUrl: z.url(),
      message: z.string().trim().min(1).max(1_000),
      variantId: z.string().nullable().default(null),
      idempotencyKey: correlationText,
    })
    .strict(),
  interpret_inbound: z.object({ leadId, messageId: correlationText }).strict(),
  send_api_response: z
    .object({
      leadId,
      text: z.string().trim().min(1).max(1_000),
      idempotencyKey: correlationText,
      correlationId: correlationText.optional(),
    })
    .strict(),
  evaluate_follow_up: z
    .object({ leadId, text: z.string().trim().min(1).max(1_000).optional() })
    .strict(),
  measure_experiment: z.object({ experimentId: correlationText }).strict(),
  adapt_strategy: z.object({ experimentId: correlationText }).strict(),
  backup_database: z.object({ destination: z.string().trim().min(1) }).strict(),
  check_integrations: z.object({}).strict(),
  poll_inbound: z.object({}).strict(),
} as const;

export type QualifyLeadPayload = z.infer<(typeof payloadSchemas)["qualify_lead"]>;
export type PrepareFirstContactPayload = z.infer<(typeof payloadSchemas)["prepare_first_contact"]>;
export type SendBrowserContactPayload = z.infer<(typeof payloadSchemas)["send_browser_contact"]>;
export type InterpretInboundPayload = z.infer<(typeof payloadSchemas)["interpret_inbound"]>;
export type SendApiResponsePayload = z.infer<(typeof payloadSchemas)["send_api_response"]>;
export type EvaluateFollowUpPayload = z.infer<(typeof payloadSchemas)["evaluate_follow_up"]>;
export type ExperimentJobPayload = z.infer<(typeof payloadSchemas)["measure_experiment"]>;
export type BackupDatabasePayload = z.infer<(typeof payloadSchemas)["backup_database"]>;
export type CheckIntegrationsPayload = z.infer<(typeof payloadSchemas)["check_integrations"]>;
export type PollInboundPayload = z.infer<(typeof payloadSchemas)["poll_inbound"]>;

export interface JobOperations {
  qualifyLead(payload: QualifyLeadPayload, job: JobRecord): void | Promise<void>;
  prepareFirstContact(payload: PrepareFirstContactPayload, job: JobRecord): void | Promise<void>;
  sendBrowserContact(payload: SendBrowserContactPayload, job: JobRecord): void | Promise<void>;
  interpretInbound(payload: InterpretInboundPayload, job: JobRecord): void | Promise<void>;
  sendApiResponse(payload: SendApiResponsePayload, job: JobRecord): void | Promise<void>;
  evaluateFollowUp(payload: EvaluateFollowUpPayload, job: JobRecord): void | Promise<void>;
  measureExperiment(payload: ExperimentJobPayload, job: JobRecord): void | Promise<void>;
  adaptStrategy(payload: ExperimentJobPayload, job: JobRecord): void | Promise<void>;
  backupDatabase(payload: BackupDatabasePayload, job: JobRecord): void | Promise<void>;
  checkIntegrations(payload: CheckIntegrationsPayload, job: JobRecord): void | Promise<void>;
  pollInbound(payload: PollInboundPayload, job: JobRecord): void | Promise<void>;
}

export interface JobHandlerDependencies {
  readonly database: AppDatabase;
  readonly operations: JobOperations;
  readonly now?: () => Date;
}

export function createJobHandlers(dependencies: JobHandlerDependencies): JobHandlerMap {
  return {
    qualify_lead: createHandler(dependencies, "qualify_lead", dependencies.operations.qualifyLead),
    prepare_first_contact: createHandler(
      dependencies,
      "prepare_first_contact",
      dependencies.operations.prepareFirstContact,
    ),
    send_browser_contact: createHandler(
      dependencies,
      "send_browser_contact",
      dependencies.operations.sendBrowserContact,
    ),
    interpret_inbound: createHandler(
      dependencies,
      "interpret_inbound",
      dependencies.operations.interpretInbound,
    ),
    send_api_response: createHandler(
      dependencies,
      "send_api_response",
      dependencies.operations.sendApiResponse,
    ),
    evaluate_follow_up: createHandler(
      dependencies,
      "evaluate_follow_up",
      dependencies.operations.evaluateFollowUp,
    ),
    measure_experiment: createHandler(
      dependencies,
      "measure_experiment",
      dependencies.operations.measureExperiment,
    ),
    adapt_strategy: createHandler(
      dependencies,
      "adapt_strategy",
      dependencies.operations.adaptStrategy,
    ),
    backup_database: createHandler(
      dependencies,
      "backup_database",
      dependencies.operations.backupDatabase,
    ),
    check_integrations: createHandler(
      dependencies,
      "check_integrations",
      dependencies.operations.checkIntegrations,
    ),
    poll_inbound: createHandler(dependencies, "poll_inbound", dependencies.operations.pollInbound),
  };
}

function createHandler<Type extends JobType>(
  dependencies: JobHandlerDependencies,
  type: Type,
  operation: (payload: never, job: JobRecord) => void | Promise<void>,
) {
  return async (job: JobRecord): Promise<void> => {
    if (job.type !== type) throw new Error(`Handler ${type} received job type ${job.type}`);
    if (wasCompleted(dependencies.database, job.id)) return;
    const payload = payloadSchemas[type].parse(job.payload);
    await operation(payload as never, job);
    markCompleted(dependencies.database, job, payload, (dependencies.now ?? (() => new Date()))());
  };
}

function wasCompleted(database: AppDatabase, jobId: string): boolean {
  return Boolean(
    database.sqlite
      .prepare("SELECT 1 FROM events WHERE type = 'worker.handler_completed' AND correlation_id = ?")
      .get(jobId),
  );
}

function markCompleted(
  database: AppDatabase,
  job: JobRecord,
  payload: object,
  now: Date,
): void {
  const candidateLeadId = "leadId" in payload && typeof payload.leadId === "string" ? payload.leadId : null;
  const lead = candidateLeadId && database.sqlite
    .prepare("SELECT 1 FROM leads WHERE id = ?")
    .get(candidateLeadId)
    ? candidateLeadId
    : null;
  database.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, 'worker.handler_completed', ?, ?, ?)
    `)
    .run(
      randomUUID(),
      lead,
      JSON.stringify({ jobType: job.type, jobId: job.id }),
      job.id,
      now.toISOString(),
    );
}
