import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";
import type { IntegrationMode } from "@/lib/env";
import { recordIntegrationFailure, recordIntegrationSuccess } from "@/worker/circuit-breaker";
import { acquireSystemMutex, releaseSystemMutex } from "@/worker/job-store";
import type { BrowserContactLimitDecision } from "@/worker/limits";

import { BrowserUnavailableError, type BrowserClient, type BrowserPageClient } from "./browser-types.ts";
import { assertInstagramUrl } from "./playwright-browser-client.ts";

export interface FirstContactCommand {
  readonly jobId: string;
  readonly leadId: string;
  readonly profileUrl: string;
  readonly message: string;
  readonly variantId: string | null;
  readonly idempotencyKey: string;
}

export interface BrowserContactDependencies {
  readonly database: AppDatabase;
  readonly client: BrowserClient;
  readonly mode: IntegrationMode;
  readonly workerId: string;
  readonly typingDelayMs: number;
  readonly evaluateLimits: () => BrowserContactLimitDecision;
  readonly now?: () => Date;
}

export type FirstContactResult =
  | { readonly status: "sent" | "already_sent" | "dry_run_blocked" }
  | { readonly status: "deferred"; readonly reason: string; readonly nextRunAt?: string }
  | { readonly status: "failed"; readonly reason: string };

export async function sendFirstContact(
  dependencies: BrowserContactDependencies,
  command: FirstContactCommand,
): Promise<FirstContactResult> {
  assertInstagramUrl(command.profileUrl);
  if (messageAlreadyExists(dependencies.database, command.idempotencyKey)) return { status: "already_sent" };

  const limitDecision = dependencies.evaluateLimits();
  if (!limitDecision.allowed) {
    return {
      status: "deferred",
      reason: limitDecision.reason,
      ...(limitDecision.nextRunAt ? { nextRunAt: limitDecision.nextRunAt } : {}),
    };
  }

  const now = dependencies.now ?? (() => new Date());
  const acquired = acquireSystemMutex(
    dependencies.database,
    "browser",
    dependencies.workerId,
    now(),
    120,
  );
  if (!acquired) return { status: "deferred", reason: "browser_mutex_busy" };

  let page: BrowserPageClient | undefined;
  try {
    const session = await dependencies.client.connect();
    const context = session.contexts[0];
    if (!context) throw new BrowserUnavailableError("browser_context_unavailable");
    page = await context.newPage();
    await page.navigate(command.profileUrl);
    await page.typeMessage(command.message, dependencies.typingDelayMs);

    if (dependencies.mode === "dry_run") {
      const evidence = await page.captureEvidence(command.jobId, "dry_run");
      recordDryRun(dependencies.database, command, evidence, now());
      recordIntegrationSuccess(dependencies.database, "browser", now());
      return { status: "dry_run_blocked" };
    }

    await page.send();
    recordSentContact(dependencies.database, command, now());
    recordIntegrationSuccess(dependencies.database, "browser", now());
    return { status: "sent" };
  } catch (error) {
    const failure = toError(error);
    if (page) await safelyCaptureFailure(page, command.jobId, failure);
    const unavailable = failure instanceof BrowserUnavailableError;
    recordIntegrationFailure(
      dependencies.database,
      "browser",
      unavailable ? "browser_unavailable" : "browser_contact_failed",
      now(),
      unavailable ? 1 : 3,
    );
    return { status: "failed", reason: unavailable ? "browser_unavailable" : "browser_contact_failed" };
  } finally {
    if (page) await page.close();
    releaseSystemMutex(dependencies.database, "browser", dependencies.workerId);
  }
}

function recordSentContact(database: AppDatabase, command: FirstContactCommand, now: Date): void {
  database.sqlite.transaction(() => {
    if (messageAlreadyExists(database, command.idempotencyKey)) return;
    const lead = database.sqlite
      .prepare("SELECT pipeline_state, channel_state, channel_owner FROM leads WHERE id = ?")
      .get(command.leadId) as
      | { pipeline_state: string; channel_state: string; channel_owner: string }
      | undefined;
    if (!lead) throw new Error(`Lead not found: ${command.leadId}`);
    if (lead.pipeline_state !== "qualified" || lead.channel_state !== "browser_contact_pending" || lead.channel_owner !== "browser") {
      throw new Error("Lead is not eligible for first browser contact");
    }

    const timestamp = now.toISOString();
    database.sqlite
      .prepare(`
        INSERT INTO messages (
          id, lead_id, direction, channel, body, variant_id, delivery_state,
          idempotency_key, sent_at, created_at
        ) VALUES (?, ?, 'outbound', 'browser', ?, ?, 'sent', ?, ?, ?)
      `)
      .run(
        randomUUID(),
        command.leadId,
        command.message,
        command.variantId,
        command.idempotencyKey,
        timestamp,
        timestamp,
      );
    database.sqlite
      .prepare(`
        UPDATE leads
        SET pipeline_state = 'contacted', channel_state = 'waiting_inbound_reply',
            channel_owner = 'browser', next_action = 'wait_inbound_reply',
            next_action_at = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(timestamp, command.leadId);
    appendContactAudit(database, command, lead, timestamp);
  })();
}

function recordDryRun(
  database: AppDatabase,
  command: FirstContactCommand,
  evidence: object,
  now: Date,
): void {
  database.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, 'browser.dry_run_blocked', ?, ?, ?)
    `)
    .run(randomUUID(), command.leadId, JSON.stringify({ jobId: command.jobId, evidence }), command.jobId, now.toISOString());
}

function appendContactAudit(
  database: AppDatabase,
  command: FirstContactCommand,
  before: { pipeline_state: string; channel_state: string; channel_owner: string },
  timestamp: string,
): void {
  database.sqlite
    .prepare(`
      INSERT INTO audit_logs (
        id, actor, action, entity_type, entity_id, before_json, after_json,
        reason, correlation_id, created_at
      ) VALUES (?, 'worker', 'browser_first_contact', 'lead', ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      command.leadId,
      JSON.stringify({
        pipelineState: before.pipeline_state,
        channelState: before.channel_state,
        channelOwner: before.channel_owner,
      }),
      JSON.stringify({
        pipelineState: "contacted",
        channelState: "waiting_inbound_reply",
        channelOwner: "browser",
      }),
      "First contact sent and persisted",
      command.jobId,
      timestamp,
    );
  database.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, 'browser.first_contact_sent', ?, ?, ?)
    `)
    .run(randomUUID(), command.leadId, JSON.stringify({ variantId: command.variantId }), command.jobId, timestamp);
}

function messageAlreadyExists(database: AppDatabase, idempotencyKey: string): boolean {
  return Boolean(
    database.sqlite
      .prepare("SELECT 1 FROM messages WHERE idempotency_key = ?")
      .get(idempotencyKey),
  );
}

async function safelyCaptureFailure(page: BrowserPageClient, jobId: string, error: Error): Promise<void> {
  try {
    await page.captureEvidence(jobId, "browser_contact_failed", error);
  } catch {
    return;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
