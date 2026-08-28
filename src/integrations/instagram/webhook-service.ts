import { createHash, randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";
import { normalizeInstagramHandle } from "@/features/leads/lead-service";
import { recordIntegrationSuccess } from "@/worker/circuit-breaker";
import { enqueueJob } from "@/worker/job-store";

import { verifyInstagramSignature } from "./signature.ts";
import { instagramWebhookSchema, type InstagramWebhookMessage } from "./webhook-types.ts";

const API_WINDOW_MS = 24 * 60 * 60 * 1_000;

export class InvalidInstagramSignatureError extends Error {
  constructor() {
    super("Invalid Instagram webhook signature");
    this.name = "InvalidInstagramSignatureError";
  }
}

export class InvalidInstagramWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInstagramWebhookError";
  }
}

export interface WebhookChallenge {
  readonly mode: string | null;
  readonly token: string | null;
  readonly challenge: string | null;
}

export interface ProcessWebhookInput {
  readonly database: AppDatabase;
  readonly appSecret: string;
  readonly signatureHeader: string | null;
  readonly rawBody: Uint8Array;
  readonly now?: () => Date;
}

export interface ProcessWebhookResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly ignored: number;
  readonly unmatched: number;
}

interface LeadMatch {
  readonly id: string;
  readonly pipelineState: string;
  readonly channelState: string;
  readonly channelOwner: string;
}

export function verifyWebhookChallenge(
  challenge: WebhookChallenge,
  expectedToken: string,
): string | null {
  if (
    challenge.mode !== "subscribe" ||
    challenge.token !== expectedToken ||
    !challenge.challenge
  ) {
    return null;
  }
  return challenge.challenge;
}

export function processInstagramWebhook(input: ProcessWebhookInput): ProcessWebhookResult {
  if (!verifyInstagramSignature(input.rawBody, input.signatureHeader, input.appSecret)) {
    throw new InvalidInstagramSignatureError();
  }

  const payload = parsePayload(input.rawBody);
  const now = input.now ?? (() => new Date());
  const result = { accepted: 0, duplicates: 0, ignored: 0, unmatched: 0 };

  for (const entry of payload.entry) {
    for (const event of entry.messaging) {
      if (!event.message || event.message.is_echo || !event.message.text?.trim()) {
        result.ignored += 1;
        continue;
      }

      const outcome = processMessageEvent(input.database, event, input.rawBody, now());
      result[outcome] += 1;
    }
  }

  recordIntegrationSuccess(input.database, "instagram", now());
  return result;
}

function parsePayload(rawBody: Uint8Array) {
  try {
    const decoded = JSON.parse(new TextDecoder().decode(rawBody)) as unknown;
    return instagramWebhookSchema.parse(decoded);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InvalidInstagramWebhookError(`Invalid Instagram webhook payload: ${message}`);
  }
}

function processMessageEvent(
  database: AppDatabase,
  event: InstagramWebhookMessage,
  rawBody: Uint8Array,
  processedAt: Date,
): "accepted" | "duplicates" | "unmatched" {
  const externalEventId = event.message!.mid;
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");

  return database.sqlite.transaction(() => {
    if (webhookWasProcessed(database, externalEventId)) return "duplicates";

    const timestamp = eventTimestamp(event, processedAt);
    const match = findLeadMatch(database, event);
    if (!match) {
      persistWebhookEvent(database, externalEventId, payloadHash, processedAt);
      createUnmatchedException(database, event, processedAt);
      return "unmatched";
    }

    const conversationId = upsertApiConversation(database, match.id, event.sender.id, timestamp);
    database.sqlite
      .prepare(`
        INSERT INTO messages (
          id, lead_id, conversation_id, direction, channel, body, external_id,
          delivery_state, created_at
        ) VALUES (?, ?, ?, 'inbound', 'instagram_api', ?, ?, 'received', ?)
      `)
      .run(
        randomUUID(),
        match.id,
        conversationId,
        event.message!.text!.trim(),
        externalEventId,
        timestamp.toISOString(),
      );

    handOffLeadToApi(database, match, externalEventId, timestamp);
    enqueueJob(database, {
      type: "interpret_inbound",
      payload: { leadId: match.id, messageId: externalEventId },
      idempotencyKey: `interpret:${externalEventId}`,
      correlationId: `webhook:${externalEventId}`,
      runAt: processedAt,
      maxAttempts: 3,
    });
    persistWebhookEvent(database, externalEventId, payloadHash, processedAt);
    return "accepted";
  })();
}

function findLeadMatch(database: AppDatabase, event: InstagramWebhookMessage): LeadMatch | null {
  const byRecipient = database.sqlite
    .prepare(`
      SELECT l.id, l.pipeline_state, l.channel_state, l.channel_owner
      FROM conversations c
      JOIN leads l ON l.id = c.lead_id
      WHERE c.meta_recipient_id = ?
    `)
    .get(event.sender.id) as
    | { id: string; pipeline_state: string; channel_state: string; channel_owner: string }
    | undefined;
  if (byRecipient) return mapLeadMatch(byRecipient);

  if (!event.sender.username) return null;
  let normalizedHandle: string;
  try {
    normalizedHandle = normalizeInstagramHandle(event.sender.username);
  } catch {
    return null;
  }
  const byHandle = database.sqlite
    .prepare(`
      SELECT id, pipeline_state, channel_state, channel_owner
      FROM leads
      WHERE normalized_handle = ?
    `)
    .get(normalizedHandle) as
    | { id: string; pipeline_state: string; channel_state: string; channel_owner: string }
    | undefined;
  return byHandle ? mapLeadMatch(byHandle) : null;
}

function mapLeadMatch(row: {
  id: string;
  pipeline_state: string;
  channel_state: string;
  channel_owner: string;
}): LeadMatch {
  return {
    id: row.id,
    pipelineState: row.pipeline_state,
    channelState: row.channel_state,
    channelOwner: row.channel_owner,
  };
}

function upsertApiConversation(
  database: AppDatabase,
  leadId: string,
  recipientId: string,
  inboundAt: Date,
): string {
  const existing = database.sqlite
    .prepare("SELECT id FROM conversations WHERE lead_id = ?")
    .get(leadId) as { id: string } | undefined;
  const conversationId = existing?.id ?? randomUUID();
  const expiresAt = new Date(inboundAt.getTime() + API_WINDOW_MS).toISOString();

  database.sqlite
    .prepare(`
      INSERT INTO conversations (
        id, lead_id, owner, meta_recipient_id, last_inbound_at,
        api_window_expires_at, created_at, updated_at
      ) VALUES (?, ?, 'api', ?, ?, ?, ?, ?)
      ON CONFLICT(lead_id) DO UPDATE SET
        owner = 'api',
        meta_recipient_id = excluded.meta_recipient_id,
        last_inbound_at = excluded.last_inbound_at,
        api_window_expires_at = excluded.api_window_expires_at,
        updated_at = excluded.updated_at
    `)
    .run(
      conversationId,
      leadId,
      recipientId,
      inboundAt.toISOString(),
      expiresAt,
      inboundAt.toISOString(),
      inboundAt.toISOString(),
    );
  return conversationId;
}

function handOffLeadToApi(
  database: AppDatabase,
  lead: LeadMatch,
  externalEventId: string,
  timestamp: Date,
): void {
  const pipelineState = lead.pipelineState === "contacted" ? "replied" : lead.pipelineState;
  const channelState = lead.channelState === "do_not_contact" ? "do_not_contact" : "api_eligible";
  const channelOwner = channelState === "do_not_contact" ? "none" : "api";
  database.sqlite
    .prepare(`
      UPDATE leads
      SET pipeline_state = ?, channel_state = ?, channel_owner = ?,
          next_action = ?, next_action_at = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      pipelineState,
      channelState,
      channelOwner,
      channelState === "do_not_contact" ? null : "interpret_inbound",
      channelState === "do_not_contact" ? null : timestamp.toISOString(),
      timestamp.toISOString(),
      lead.id,
    );
  database.sqlite
    .prepare(`
      INSERT INTO audit_logs (
        id, actor, action, entity_type, entity_id, before_json, after_json,
        reason, correlation_id, created_at
      ) VALUES (?, 'webhook', 'instagram_api_handoff', 'lead', ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      lead.id,
      JSON.stringify({
        pipelineState: lead.pipelineState,
        channelState: lead.channelState,
        channelOwner: lead.channelOwner,
      }),
      JSON.stringify({ pipelineState, channelState, channelOwner }),
      "Verified inbound reply transferred conversation ownership to the official API",
      `webhook:${externalEventId}`,
      timestamp.toISOString(),
    );
}

function webhookWasProcessed(database: AppDatabase, externalEventId: string): boolean {
  return Boolean(
    database.sqlite
      .prepare("SELECT 1 FROM webhook_events WHERE external_event_id = ?")
      .get(externalEventId),
  );
}

function persistWebhookEvent(
  database: AppDatabase,
  externalEventId: string,
  payloadHash: string,
  processedAt: Date,
): void {
  database.sqlite
    .prepare(`
      INSERT INTO webhook_events (external_event_id, payload_hash, processed_at)
      VALUES (?, ?, ?)
    `)
    .run(externalEventId, payloadHash, processedAt.toISOString());
}

function createUnmatchedException(
  database: AppDatabase,
  event: InstagramWebhookMessage,
  timestamp: Date,
): void {
  database.sqlite
    .prepare(`
      INSERT INTO exceptions (id, type, severity, status, context_json, created_at)
      VALUES (?, 'instagram_sender_unmatched', 'warning', 'open', ?, ?)
    `)
    .run(
      randomUUID(),
      JSON.stringify({
        externalEventId: event.message!.mid,
        senderId: event.sender.id,
        senderUsername: event.sender.username ?? null,
      }),
      timestamp.toISOString(),
    );
}

function eventTimestamp(event: InstagramWebhookMessage, fallback: Date): Date {
  const parsed = new Date(event.timestamp);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
