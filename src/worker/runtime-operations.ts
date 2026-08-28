import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

import type { AppDatabase } from "@/db/client";
import { createVerifiedBackup } from "@/db/backup";
import { evaluateFollowUp } from "@/features/campaigns/follow-up";
import { handleInboundConversation } from "@/features/conversations/conversation-service";
import { adaptExperiment } from "@/features/experiments/adaptation";
import { measureExperiment } from "@/features/experiments/metrics";
import { qualifyLead, readLead } from "@/features/leads/lead-service";
import type { BrowserClient } from "@/integrations/browser/browser-types";
import { sendFirstContact } from "@/integrations/browser/first-contact";
import { pollInstagramConversations } from "@/integrations/instagram/conversations-poller";
import { sendInstagramMessage } from "@/integrations/instagram/meta-client";
import type { DecisionModel } from "@/integrations/openai/client";
import type { AiPricing } from "@/integrations/openai/budget";
import type { BusinessConfig } from "@/lib/business-config";
import type { AppEnv } from "@/lib/env";

import { isCircuitOpen } from "./circuit-breaker.ts";
import { enqueueJob } from "./job-store.ts";
import { evaluateBrowserContactLimits } from "./limits.ts";
import type { JobOperations } from "./handlers.ts";

export interface RuntimeOperationDependencies {
  readonly database: AppDatabase;
  readonly business: BusinessConfig;
  readonly env: AppEnv;
  readonly browserClient: BrowserClient;
  readonly decisionModel: DecisionModel;
  /** Resolved from the configured AI provider, not read from env directly. */
  readonly aiModel: string;
  readonly aiModelFast: string;
  readonly aiPricing: AiPricing;
  readonly projectedAiCallCostUsd: number;
  readonly workerId: string;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export function createRuntimeJobOperations(
  dependencies: RuntimeOperationDependencies,
): JobOperations {
  const now = dependencies.now ?? (() => new Date());
  return {
    qualifyLead: (payload, job) => {
      qualifyLead(dependencies.database, payload.leadId, dependencies.business, {
        actor: "worker",
        correlationId: job.correlationId,
      });
    },
    prepareFirstContact: (payload, job) => {
      enqueueJob(dependencies.database, {
        type: "send_browser_contact",
        payload,
        idempotencyKey: `send:${payload.idempotencyKey}`,
        correlationId: job.correlationId,
        runAt: now(),
        maxAttempts: 3,
      });
    },
    sendBrowserContact: async (payload, job) => {
      const result = await sendFirstContact(
        {
          database: dependencies.database,
          client: dependencies.browserClient,
          mode: dependencies.env.browserMode,
          workerId: dependencies.workerId,
          typingDelayMs: 35,
          evaluateLimits: () => browserLimitDecision(dependencies, payload.leadId, now()),
          now,
        },
        { jobId: job.id, ...payload },
      );
      if (result.status === "failed") throw new Error(result.reason);
      if (result.status === "deferred") {
        const nextRunAt = result.nextRunAt
          ? new Date(result.nextRunAt)
          : new Date(now().getTime() + 15 * 60 * 1_000);
        enqueueJob(dependencies.database, {
          type: "send_browser_contact",
          payload,
          idempotencyKey: `${job.idempotencyKey}:deferred:${nextRunAt.toISOString()}`,
          correlationId: job.correlationId,
          runAt: nextRunAt,
          maxAttempts: job.maxAttempts,
        });
      }
    },
    interpretInbound: async (payload, job) => {
      await handleInboundConversation(
        {
          database: dependencies.database,
          business: dependencies.business,
          model: dependencies.decisionModel,
          fastModel: dependencies.aiModelFast,
          mainModel: dependencies.aiModel,
          monthlyBudgetUsd: dependencies.env.openAiMonthlyBudgetUsd,
          pricing: dependencies.aiPricing,
          projectedCallCostUsd: dependencies.projectedAiCallCostUsd,
          now,
        },
        { ...payload, correlationId: job.correlationId },
      );
    },
    sendApiResponse: async (payload, job) => {
      await sendInstagramMessage(
        {
          database: dependencies.database,
          mode: dependencies.env.instagramMode,
          liveAuthorized: dependencies.env.instagramLiveAuthorized,
          accessToken: dependencies.env.instagramPageAccessToken,
          businessAccountId: dependencies.env.instagramBusinessAccountId,
          apiVersion: dependencies.env.instagramGraphApiVersion,
          now,
        },
        {
          leadId: payload.leadId,
          text: payload.text,
          idempotencyKey: payload.idempotencyKey,
          correlationId: payload.correlationId ?? job.correlationId,
        },
      );
    },
    evaluateFollowUp: (payload, job) => {
      evaluateAndRouteFollowUp(dependencies, payload.leadId, payload.text, job, now());
    },
    measureExperiment: (payload, job) => {
      const report = measureExperiment(dependencies.database, payload.experimentId);
      appendWorkerEvent(dependencies.database, null, "experiment.measured", report, job.correlationId, now());
    },
    adaptStrategy: (payload, job) => {
      const result = adaptExperiment(dependencies.database, payload.experimentId);
      appendWorkerEvent(dependencies.database, null, "experiment.adaptation_evaluated", result, job.correlationId, now());
    },
    backupDatabase: async (payload) => {
      const destination = assertBackupDestination(payload.destination);
      const result = await createVerifiedBackup(dependencies.database, destination);
      dependencies.database.sqlite
        .prepare(`
          INSERT INTO backups (id, path, integrity_check, restore_tested_at, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(randomUUID(), result.path, result.integrityCheck, now().toISOString(), now().toISOString());
    },
    pollInbound: async (_payload, job) => {
      const startedAt = now();
      try {
        const result = await pollInstagramConversations({
          database: dependencies.database,
          mode: dependencies.env.instagramMode,
          accessToken: dependencies.env.instagramPageAccessToken,
          businessAccountId: dependencies.env.instagramBusinessAccountId,
          apiVersion: dependencies.env.instagramGraphApiVersion,
          now,
        });
        appendWorkerEvent(dependencies.database, null, "inbound.polled", result, job.correlationId, startedAt);
      } finally {
        // Rescheduled in `finally` so a failed poll still keeps the loop alive;
        // the failure itself is recorded by the circuit breaker.
        scheduleNextPoll(dependencies, startedAt);
      }
    },
    checkIntegrations: (_payload, job) => {
      const health = dependencies.database.sqlite
        .prepare("SELECT * FROM integration_health ORDER BY integration")
        .all();
      appendWorkerEvent(dependencies.database, null, "integrations.checked", { health }, job.correlationId, now());
    },
  };
}

/**
 * Each poll queues the next one, so the recurring schedule lives in the durable
 * job table and survives a worker restart. The timestamp in the idempotency key
 * keeps a restart from stacking duplicate polls onto the same slot.
 */
export function scheduleNextPoll(
  dependencies: Pick<RuntimeOperationDependencies, "database" | "env">,
  from: Date,
): void {
  const runAt = new Date(from.getTime() + dependencies.env.inboundPollSeconds * 1_000);
  const slot = Math.floor(runAt.getTime() / (dependencies.env.inboundPollSeconds * 1_000));
  enqueueJob(dependencies.database, {
    type: "poll_inbound",
    payload: {},
    idempotencyKey: `poll-inbound:${slot}`,
    correlationId: `poll-inbound:${slot}`,
    runAt,
    maxAttempts: 3,
  });
}

function browserLimitDecision(
  dependencies: RuntimeOperationDependencies,
  leadId: string,
  now: Date,
) {
  const lead = readLead(dependencies.database, leadId);
  const generalPaused = readPause(dependencies.database, "general_pause");
  const doNotContact = Boolean(
    dependencies.database.sqlite
      .prepare("SELECT 1 FROM do_not_contact WHERE normalized_handle = ?")
      .get(lead.normalizedHandle),
  );
  const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sent = dependencies.database.sqlite
    .prepare(`
      SELECT COUNT(*) AS count, MAX(sent_at) AS last_sent_at
      FROM messages
      WHERE direction = 'outbound' AND channel = 'browser' AND sent_at >= ?
    `)
    .get(startOfUtcDay.toISOString()) as { count: number; last_sent_at: string | null };
  const warmup = dependencies.database.sqlite
    .prepare("SELECT MIN(created_at) AS started_at FROM leads")
    .get() as { started_at: string | null };
  return evaluateBrowserContactLimits({
    generalPaused,
    browserCircuitOpen: isCircuitOpen(dependencies.database, "browser"),
    doNotContact,
    channelState: lead.channelState,
    channelOwner: lead.channelOwner,
    now,
    operatingHours: dependencies.env.operatingHours,
    operatingTimezone: dependencies.env.operatingTimezone,
    maxDmsPerDay: dependencies.env.maxDmsPerDay,
    minSecondsBetweenDms: dependencies.env.minSecondsBetweenDms,
    maxSecondsBetweenDms: dependencies.env.maxSecondsBetweenDms,
    warmupStartedAt: warmup.started_at ? new Date(warmup.started_at) : now,
    sentToday: sent.count,
    lastSentAt: sent.last_sent_at ? new Date(sent.last_sent_at) : null,
    spacingRandomValue: (dependencies.random ?? Math.random)(),
  });
}

function evaluateAndRouteFollowUp(
  dependencies: RuntimeOperationDependencies,
  leadId: string,
  text: string | undefined,
  job: { idempotencyKey: string; correlationId: string },
  now: Date,
): void {
  const lead = readLead(dependencies.database, leadId);
  const conversation = dependencies.database.sqlite
    .prepare(`
      SELECT last_inbound_at, api_window_expires_at
      FROM conversations
      WHERE lead_id = ?
    `)
    .get(leadId) as { last_inbound_at: string | null; api_window_expires_at: string | null } | undefined;
  const decision = evaluateFollowUp({
    channelState: lead.channelState,
    channelOwner: lead.channelOwner,
    pipelineState: lead.pipelineState,
    lastInboundAt: conversation?.last_inbound_at ?? null,
    apiWindowExpiresAt: conversation?.api_window_expires_at ?? null,
    doNotContact: lead.channelState === "do_not_contact",
    integrationHealthy: !isCircuitOpen(dependencies.database, "instagram"),
    generalPaused: readPause(dependencies.database, "general_pause"),
    now,
  });
  if (decision.action === "send_api_follow_up" && text) {
    enqueueJob(dependencies.database, {
      type: "send_api_response",
      payload: {
        leadId,
        text,
        idempotencyKey: `api-follow-up:${job.idempotencyKey}`,
        correlationId: job.correlationId,
      },
      idempotencyKey: `send-api-follow-up:${job.idempotencyKey}`,
      correlationId: job.correlationId,
      runAt: now,
      maxAttempts: 3,
    });
  } else {
    dependencies.database.sqlite
      .prepare("UPDATE leads SET next_action = NULL, next_action_at = NULL, updated_at = ? WHERE id = ?")
      .run(now.toISOString(), leadId);
  }
  appendWorkerEvent(dependencies.database, leadId, "follow_up.evaluated", decision, job.correlationId, now);
}

function appendWorkerEvent(
  database: AppDatabase,
  leadId: string | null,
  type: string,
  payload: unknown,
  correlationId: string,
  now: Date,
): void {
  database.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(randomUUID(), leadId, type, JSON.stringify(payload), correlationId, now.toISOString());
}

function readPause(database: AppDatabase, key: string): boolean {
  const row = database.sqlite
    .prepare("SELECT value_json FROM system_settings WHERE key = ?")
    .get(key) as { value_json: string } | undefined;
  if (!row) return true;
  try {
    return (JSON.parse(row.value_json) as { paused?: unknown }).paused !== false;
  } catch {
    return true;
  }
}

function assertBackupDestination(destination: string): string {
  const backupRoot = resolve("backups");
  const resolved = resolve(destination);
  const relation = relative(backupRoot, resolved);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Backup destination must stay inside the backups directory");
  }
  return resolved;
}
