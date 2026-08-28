import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";

import type { EnqueueJobInput, JobRecord, JobStatus, JobType } from "./job-types.ts";

interface JobRow {
  id: string;
  type: JobType;
  payload_json: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  idempotency_key: string;
  correlation_id: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueJobResult {
  readonly jobId: string;
  readonly created: boolean;
}

export function enqueueJob(database: AppDatabase, input: EnqueueJobInput): EnqueueJobResult {
  const existing = database.sqlite
    .prepare("SELECT id FROM jobs WHERE idempotency_key = ?")
    .get(input.idempotencyKey) as { id: string } | undefined;
  if (existing) return { jobId: existing.id, created: false };

  return database.sqlite.transaction(() => {
    const concurrent = database.sqlite
      .prepare("SELECT id FROM jobs WHERE idempotency_key = ?")
      .get(input.idempotencyKey) as { id: string } | undefined;
    if (concurrent) return { jobId: concurrent.id, created: false };

    const jobId = randomUUID();
    const timestamp = new Date().toISOString();
    database.sqlite
      .prepare(`
        INSERT INTO jobs (
          id, type, payload_json, status, attempts, max_attempts, run_at,
          idempotency_key, correlation_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        jobId,
        input.type,
        JSON.stringify(input.payload),
        input.maxAttempts,
        input.runAt.toISOString(),
        input.idempotencyKey,
        input.correlationId,
        timestamp,
        timestamp,
      );
    return { jobId, created: true };
  })();
}

export function leaseDueJob(
  database: AppDatabase,
  workerId: string,
  now: Date,
  leaseSeconds = 60,
): JobRecord | null {
  return database.sqlite.transaction(() => {
    const candidate = database.sqlite
      .prepare(`
        SELECT * FROM jobs
        WHERE status = 'queued' AND run_at <= ?
        ORDER BY run_at, created_at
        LIMIT 1
      `)
      .get(now.toISOString()) as JobRow | undefined;
    if (!candidate) return null;

    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
    const update = database.sqlite
      .prepare(`
        UPDATE jobs
        SET status = 'running', lease_owner = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = 'queued'
      `)
      .run(workerId, leaseExpiresAt, now.toISOString(), candidate.id);
    return update.changes === 1 ? getJob(database, candidate.id) : null;
  })();
}

export function completeJob(database: AppDatabase, jobId: string, now: Date): void {
  database.sqlite
    .prepare(`
      UPDATE jobs
      SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'running'
    `)
    .run(now.toISOString(), jobId);
}

export function failJob(database: AppDatabase, job: JobRecord, error: Error, now: Date): void {
  const attempts = job.attempts + 1;
  const deadLetter = attempts >= job.maxAttempts;
  const nextRunAt = new Date(now.getTime() + Math.min(300, 2 ** attempts) * 1_000).toISOString();
  database.sqlite
    .prepare(`
      UPDATE jobs
      SET status = ?, attempts = ?, run_at = ?, lease_owner = NULL,
          lease_expires_at = NULL, last_error = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      deadLetter ? "dead_letter" : "queued",
      attempts,
      nextRunAt,
      sanitizeError(error),
      now.toISOString(),
      job.id,
    );

  if (deadLetter) createDeadLetterException(database, job, error, now);
}

export function recoverExpiredLeases(database: AppDatabase, now: Date): number {
  return database.sqlite
    .prepare(`
      UPDATE jobs
      SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
          last_error = 'recovered_expired_lease', updated_at = ?
      WHERE status = 'running' AND lease_expires_at <= ?
    `)
    .run(now.toISOString(), now.toISOString()).changes;
}

export function getJob(database: AppDatabase, jobId: string): JobRecord {
  const row = database.sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
  if (!row) throw new Error(`Job not found: ${jobId}`);
  return mapJobRow(row);
}

export function acquireSystemMutex(
  database: AppDatabase,
  name: string,
  owner: string,
  now: Date,
  leaseSeconds: number,
): boolean {
  return database.sqlite.transaction(() => {
    const existing = database.sqlite
      .prepare("SELECT lease_owner, lease_expires_at FROM system_mutexes WHERE name = ?")
      .get(name) as { lease_owner: string; lease_expires_at: string } | undefined;
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
    if (!existing) {
      database.sqlite
        .prepare(`
          INSERT INTO system_mutexes (name, lease_owner, lease_expires_at, updated_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(name, owner, leaseExpiresAt, now.toISOString());
      return true;
    }

    if (existing.lease_owner !== owner && existing.lease_expires_at > now.toISOString()) return false;
    database.sqlite
      .prepare(`
        UPDATE system_mutexes
        SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
        WHERE name = ?
      `)
      .run(owner, leaseExpiresAt, now.toISOString(), name);
    return true;
  })();
}

export function releaseSystemMutex(database: AppDatabase, name: string, owner: string): void {
  database.sqlite
    .prepare("DELETE FROM system_mutexes WHERE name = ? AND lease_owner = ?")
    .run(name, owner);
}

function mapJobRow(row: JobRow): JobRecord {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload_json) as Readonly<Record<string, unknown>>,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeError(error: Error): string {
  return error.message.replaceAll(/(?:Bearer|token|secret|password)\s+[A-Za-z0-9._-]+/giu, "[redacted]").slice(0, 2_000);
}

function createDeadLetterException(database: AppDatabase, job: JobRecord, error: Error, now: Date): void {
  database.sqlite
    .prepare(`
      INSERT INTO exceptions (
        id, type, severity, status, context_json, created_at
      ) VALUES (?, 'job_dead_letter', 'warning', 'open', ?, ?)
    `)
    .run(
      randomUUID(),
      JSON.stringify({ jobId: job.id, jobType: job.type, error: sanitizeError(error) }),
      now.toISOString(),
    );
}
