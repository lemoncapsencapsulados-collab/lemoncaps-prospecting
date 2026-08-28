import { createHash, randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";
import type { IntegrationMode } from "@/lib/env";
import { recordIntegrationFailure, recordIntegrationSuccess } from "@/worker/circuit-breaker";

import {
  evaluateInstagramSendPolicy,
  type InstagramSendBlockReason,
  type InstagramSendPolicyDecision,
} from "./send-policy.ts";

export interface InstagramMessageCommand {
  readonly leadId: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface InstagramClientDependencies {
  readonly database: AppDatabase;
  readonly mode: IntegrationMode;
  readonly liveAuthorized?: boolean;
  readonly accessToken?: string;
  readonly businessAccountId?: string;
  readonly apiVersion?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export type InstagramSendResult =
  | { readonly status: "sent"; readonly mode: "simulated" | "live"; readonly externalId: string }
  | { readonly status: "already_sent"; readonly externalId: string }
  | { readonly status: "dry_run_blocked" }
  | { readonly status: "blocked"; readonly reason: InstagramSendBlockReason };

interface GraphSendResponse {
  readonly message_id: string;
}

export class InstagramApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramApiError";
  }
}

export async function sendInstagramMessage(
  dependencies: InstagramClientDependencies,
  command: InstagramMessageCommand,
): Promise<InstagramSendResult> {
  const existing = findExistingMessage(dependencies.database, command.idempotencyKey);
  if (existing) return { status: "already_sent", externalId: existing.externalId };

  const now = dependencies.now ?? (() => new Date());
  const decision = evaluateInstagramSendPolicy(dependencies.database, command.leadId, now());
  if (!decision.allowed) {
    if (decision.reason === "api_window_expired") {
      closeExpiredWindow(dependencies.database, command, now());
    }
    return { status: "blocked", reason: decision.reason };
  }

  if (dependencies.mode === "dry_run") {
    recordDryRun(dependencies.database, command, decision, now());
    return { status: "dry_run_blocked" };
  }

  let externalId: string;
  if (dependencies.mode === "simulated") {
    externalId = simulatedExternalId(command.idempotencyKey);
  } else {
    assertLiveConfiguration(dependencies);
    try {
      externalId = await sendLiveRequest(dependencies, command.text, decision.recipientId);
    } catch (error) {
      recordIntegrationFailure(dependencies.database, "instagram", "instagram_send_failed", now());
      throw error;
    }
  }

  persistSentMessage(dependencies.database, command, decision, externalId, now());
  recordIntegrationSuccess(dependencies.database, "instagram", now());
  return { status: "sent", mode: dependencies.mode, externalId };
}

function findExistingMessage(
  database: AppDatabase,
  idempotencyKey: string,
): { externalId: string } | null {
  const row = database.sqlite
    .prepare("SELECT external_id FROM messages WHERE idempotency_key = ?")
    .get(idempotencyKey) as { external_id: string | null } | undefined;
  return row?.external_id ? { externalId: row.external_id } : null;
}

async function sendLiveRequest(
  dependencies: InstagramClientDependencies,
  text: string,
  recipientId: string,
): Promise<string> {
  const request = dependencies.fetch ?? globalThis.fetch;
  const url = `https://graph.instagram.com/${dependencies.apiVersion}/${dependencies.businessAccountId}/messages`;
  const response = await request(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dependencies.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  if (!response.ok) {
    throw new InstagramApiError(`Instagram Send API returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as Partial<GraphSendResponse>;
  if (!body.message_id) throw new InstagramApiError("Instagram Send API response has no message_id");
  return body.message_id;
}

function assertLiveConfiguration(dependencies: InstagramClientDependencies): void {
  if (!dependencies.liveAuthorized) {
    throw new InstagramApiError("Live Instagram mode is not explicitly authorized");
  }
  if (!dependencies.accessToken || !dependencies.businessAccountId || !dependencies.apiVersion) {
    throw new InstagramApiError("Live Instagram credentials are incomplete");
  }
}

function persistSentMessage(
  database: AppDatabase,
  command: InstagramMessageCommand,
  decision: Extract<InstagramSendPolicyDecision, { allowed: true }>,
  externalId: string,
  now: Date,
): void {
  database.sqlite.transaction(() => {
    if (findExistingMessage(database, command.idempotencyKey)) return;
    const timestamp = now.toISOString();
    database.sqlite
      .prepare(`
        INSERT INTO messages (
          id, lead_id, conversation_id, direction, channel, body, external_id,
          delivery_state, idempotency_key, sent_at, created_at
        ) VALUES (?, ?, ?, 'outbound', 'instagram_api', ?, ?, 'sent', ?, ?, ?)
      `)
      .run(
        randomUUID(),
        command.leadId,
        decision.conversationId,
        command.text,
        externalId,
        command.idempotencyKey,
        timestamp,
        timestamp,
      );
    database.sqlite
      .prepare(`
        UPDATE leads
        SET channel_state = 'api_active', channel_owner = 'api',
            next_action = 'wait_inbound_reply', next_action_at = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(timestamp, command.leadId);
    database.sqlite
      .prepare(`
        INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
        VALUES (?, ?, 'instagram_api.message_sent', ?, ?, ?)
      `)
      .run(
        randomUUID(),
        command.leadId,
        JSON.stringify({ externalId }),
        command.correlationId,
        timestamp,
      );
  })();
}

function recordDryRun(
  database: AppDatabase,
  command: InstagramMessageCommand,
  decision: Extract<InstagramSendPolicyDecision, { allowed: true }>,
  now: Date,
): void {
  const existing = database.sqlite
    .prepare("SELECT 1 FROM events WHERE type = 'instagram_api.dry_run_blocked' AND correlation_id = ?")
    .get(command.correlationId);
  if (existing) return;
  database.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, 'instagram_api.dry_run_blocked', ?, ?, ?)
    `)
    .run(
      randomUUID(),
      command.leadId,
      JSON.stringify({ recipientId: decision.recipientId, idempotencyKey: command.idempotencyKey }),
      command.correlationId,
      now.toISOString(),
    );
}

function closeExpiredWindow(
  database: AppDatabase,
  command: InstagramMessageCommand,
  now: Date,
): void {
  database.sqlite.transaction(() => {
    const timestamp = now.toISOString();
    database.sqlite
      .prepare(`
        UPDATE leads
        SET channel_state = 'api_window_closed', channel_owner = 'api',
            next_action = 'human_review', next_action_at = ?, updated_at = ?
        WHERE id = ? AND channel_state IN ('api_eligible', 'api_active')
      `)
      .run(timestamp, timestamp, command.leadId);
    const existing = database.sqlite
      .prepare("SELECT 1 FROM exceptions WHERE lead_id = ? AND type = 'instagram_api_window_expired' AND status = 'open'")
      .get(command.leadId);
    if (!existing) {
      database.sqlite
        .prepare(`
          INSERT INTO exceptions (
            id, lead_id, type, severity, status, context_json, created_at
          ) VALUES (?, ?, 'instagram_api_window_expired', 'warning', 'open', ?, ?)
        `)
        .run(
          randomUUID(),
          command.leadId,
          JSON.stringify({ correlationId: command.correlationId }),
          timestamp,
        );
    }
  })();
}

function simulatedExternalId(idempotencyKey: string): string {
  return `simulated:${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
}
