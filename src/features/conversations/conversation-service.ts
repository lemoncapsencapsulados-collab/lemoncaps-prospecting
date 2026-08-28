import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";
import { optOutLead } from "@/features/leads/do-not-contact";
import { readLead, transitionPipeline } from "@/features/leads/lead-service";
import type { LeadRecord } from "@/features/leads/types";
import {
  AiBudgetExhaustedError,
  assertAiBudgetAvailable,
  recordAiCall,
  type AiPricing,
} from "@/integrations/openai/budget";
import {
  enforceClaimsPolicy,
  normalizePolicyText,
  type ClaimsPolicyReason,
} from "@/integrations/openai/claims-policy";
import type { DecisionModel, ModelDecisionResult } from "@/integrations/openai/client";
import {
  conversationDecisionSchema,
  type ConversationDecision,
} from "@/integrations/openai/decision-schema";
import type {
  DecisionPromptContext,
  PublicConversationMessage,
} from "@/integrations/openai/prompt";
import { evaluateInstagramSendPolicy } from "@/integrations/instagram/send-policy";
import type { BusinessConfig } from "@/lib/business-config";
import { recordIntegrationFailure, recordIntegrationSuccess } from "@/worker/circuit-breaker";
import { enqueueJob } from "@/worker/job-store";

export interface ConversationDependencies {
  readonly database: AppDatabase;
  readonly business: BusinessConfig;
  readonly model: DecisionModel;
  readonly fastModel: string;
  readonly mainModel: string;
  readonly monthlyBudgetUsd: number;
  readonly pricing: AiPricing;
  readonly projectedCallCostUsd: number;
  readonly now?: () => Date;
}

export interface HandleInboundCommand {
  readonly leadId: string;
  readonly messageId: string;
  readonly correlationId: string;
}

export type ConversationHandlingResult =
  | { readonly status: "opted_out" }
  | { readonly status: "reply_queued"; readonly action: ConversationDecision["action"] }
  | { readonly status: "follow_up_queued" }
  | { readonly status: "waiting" }
  | { readonly status: "closed" }
  | { readonly status: "human_review"; readonly reason: string }
  | { readonly status: "ai_paused"; readonly reason: "openai_budget_exhausted" };

interface InboundRow {
  id: string;
  body: string;
}

const responseActions = new Set<ConversationDecision["action"]>([
  "respond",
  "ask",
  "introduce",
  "handle_objection",
  "handoff_whatsapp",
]);

export async function handleInboundConversation(
  dependencies: ConversationDependencies,
  command: HandleInboundCommand,
): Promise<ConversationHandlingResult> {
  const now = dependencies.now ?? (() => new Date());
  const lead = readLead(dependencies.database, command.leadId);
  const inbound = readInboundMessage(dependencies.database, command);

  if (isExplicitOptOut(inbound.body)) {
    optOutLead(dependencies.database, {
      leadId: command.leadId,
      source: "instagram_inbound",
      reason: inbound.body,
      correlationId: command.correlationId,
    });
    return { status: "opted_out" };
  }

  const context = buildContext(dependencies.database, dependencies.business, lead);
  let triage: ConversationDecision;
  try {
    const triageResult = await callAndRecordModel(
      dependencies,
      { ...context, triageDecision: undefined },
      dependencies.fastModel,
      "intent",
      now(),
    );
    triage = triageResult.decision;
  } catch (error) {
    return handleModelFailure(dependencies.database, command, error, now());
  }

  if (triage.intent === "opt_out") {
    optOutLead(dependencies.database, {
      leadId: command.leadId,
      source: "instagram_inbound",
      reason: "AI classified an explicit opt-out after deterministic checks",
      correlationId: command.correlationId,
    });
    return { status: "opted_out" };
  }

  let decision = triage;
  if (requiresMainDecision(triage)) {
    try {
      const mainResult = await callAndRecordModel(
        dependencies,
        { ...context, triageDecision: triage },
        dependencies.mainModel,
        "response",
        now(),
      );
      decision = mainResult.decision;
    } catch (error) {
      return handleModelFailure(dependencies.database, command, error, now());
    }
  }

  recordDecision(dependencies.database, command, decision, now());
  return routeDecision(dependencies, command, decision, now());
}

async function callAndRecordModel(
  dependencies: ConversationDependencies,
  context: DecisionPromptContext,
  model: string,
  purpose: "intent" | "response",
  now: Date,
): Promise<ModelDecisionResult> {
  assertAiBudgetAvailable(
    dependencies.database,
    dependencies.monthlyBudgetUsd,
    dependencies.projectedCallCostUsd,
    now,
  );
  const result = await dependencies.model.decide({ model, purpose, context });
  const parsedDecision = conversationDecisionSchema.parse(result.decision);
  recordAiCall(dependencies.database, {
    leadId: context.leadId,
    purpose,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    pricing: dependencies.pricing,
    now,
  });
  recordIntegrationSuccess(dependencies.database, "openai", now);
  return { ...result, decision: parsedDecision };
}

function routeDecision(
  dependencies: ConversationDependencies,
  command: HandleInboundCommand,
  decision: ConversationDecision,
  now: Date,
): ConversationHandlingResult {
  if (responseActions.has(decision.action)) {
    if (!decision.responseText) {
      return moveToHumanReview(dependencies.database, command, "missing_response_text", now);
    }
    if (decision.action === "handoff_whatsapp" && !dependencies.business.whatsappLink) {
      return moveToHumanReview(dependencies.database, command, "whatsapp_link_pending", now);
    }

    const claims = enforceClaimsPolicy(decision.responseText, dependencies.business);
    if (!claims.allowed) {
      return moveToHumanReview(dependencies.database, command, claims.reason, now);
    }
    const policy = evaluateInstagramSendPolicy(dependencies.database, command.leadId, now);
    if (!policy.allowed) {
      return moveToHumanReview(dependencies.database, command, `channel_policy:${policy.reason}`, now);
    }
    enqueueJob(dependencies.database, {
      type: "send_api_response",
      payload: {
        leadId: command.leadId,
        text: decision.responseText,
        idempotencyKey: `api-response:${command.messageId}`,
        correlationId: command.correlationId,
      },
      idempotencyKey: `send-api-response:${command.messageId}`,
      correlationId: command.correlationId,
      runAt: now,
      maxAttempts: 3,
    });
    return { status: "reply_queued", action: decision.action };
  }

  if (decision.action === "schedule_follow_up" && decision.followUpAt) {
    enqueueJob(dependencies.database, {
      type: "evaluate_follow_up",
      payload: { leadId: command.leadId, sourceMessageId: command.messageId },
      idempotencyKey: `follow-up:${command.messageId}`,
      correlationId: command.correlationId,
      runAt: new Date(decision.followUpAt),
      maxAttempts: 3,
    });
    updateNextAction(dependencies.database, command.leadId, "follow_up", decision.followUpAt, now);
    return { status: "follow_up_queued" };
  }

  if (decision.action === "close") {
    const lead = readLead(dependencies.database, command.leadId);
    if (lead.pipelineState !== "closed") {
      transitionPipeline(dependencies.database, {
        leadId: command.leadId,
        to: "closed",
        actor: "system",
        reason: "Conversation decision closed the lead",
        correlationId: command.correlationId,
      });
    }
    updateNextAction(dependencies.database, command.leadId, null, null, now);
    return { status: "closed" };
  }

  if (decision.action === "escalate_human") {
    return moveToHumanReview(
      dependencies.database,
      command,
      decision.escalationReason ?? "model_requested_human_review",
      now,
    );
  }

  updateNextAction(dependencies.database, command.leadId, "wait_inbound_reply", null, now);
  return { status: "waiting" };
}

function buildContext(
  database: AppDatabase,
  business: BusinessConfig,
  lead: LeadRecord,
): DecisionPromptContext {
  const rows = database.sqlite
    .prepare(`
      SELECT direction, body, created_at
      FROM messages
      WHERE lead_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `)
    .all(lead.id) as Array<{ direction: "inbound" | "outbound"; body: string; created_at: string }>;
  const conversationHistory: PublicConversationMessage[] = rows.reverse().map((row) => ({
    direction: row.direction,
    body: row.body,
    createdAt: row.created_at,
  }));
  return {
    leadId: lead.id,
    funnel: lead.funnel,
    channelState: lead.channelState,
    publicProfile: JSON.parse(lead.publicProfileJson) as Readonly<Record<string, unknown>>,
    conversationHistory,
    experimentAssignment: readExperimentAssignment(database, lead.id),
    business,
  };
}

function readExperimentAssignment(
  database: AppDatabase,
  leadId: string,
): Readonly<Record<string, unknown>> | null {
  const row = database.sqlite
    .prepare(`
      SELECT a.experiment_id, a.variant_id, v.config_json
      FROM experiment_assignments a
      JOIN experiment_variants v ON v.id = a.variant_id
      WHERE a.lead_id = ?
      ORDER BY a.assigned_at DESC
      LIMIT 1
    `)
    .get(leadId) as
    | { experiment_id: string; variant_id: string; config_json: string }
    | undefined;
  return row
    ? {
        experimentId: row.experiment_id,
        variantId: row.variant_id,
        config: JSON.parse(row.config_json) as unknown,
      }
    : null;
}

function readInboundMessage(database: AppDatabase, command: HandleInboundCommand): InboundRow {
  const row = database.sqlite
    .prepare(`
      SELECT id, body
      FROM messages
      WHERE lead_id = ? AND direction = 'inbound' AND (id = ? OR external_id = ?)
      LIMIT 1
    `)
    .get(command.leadId, command.messageId, command.messageId) as InboundRow | undefined;
  if (!row) throw new Error(`Inbound message not found: ${command.messageId}`);
  return row;
}

function isExplicitOptOut(text: string): boolean {
  const normalized = normalizePolicyText(text);
  return /(?:^|\b)(?:pare de (?:mandar|enviar)|nao (?:me )?(?:mande|envie)|remova meu contato|quero sair|cancele meu contato|stop)(?:\b|$)/u.test(
    normalized,
  );
}

function requiresMainDecision(decision: ConversationDecision): boolean {
  return decision.action !== "wait" && decision.action !== "close" && decision.intent !== "not_interested";
}

function recordDecision(
  database: AppDatabase,
  command: HandleInboundCommand,
  decision: ConversationDecision,
  now: Date,
): void {
  database.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, 'ai.decision', ?, ?, ?)
    `)
    .run(randomUUID(), command.leadId, JSON.stringify(decision), command.correlationId, now.toISOString());
}

function moveToHumanReview(
  database: AppDatabase,
  command: HandleInboundCommand,
  reason: ClaimsPolicyReason | string,
  now: Date,
): ConversationHandlingResult {
  database.sqlite.transaction(() => {
    const lead = readLead(database, command.leadId);
    const timestamp = now.toISOString();
    database.sqlite
      .prepare(`
        UPDATE leads
        SET channel_state = 'human_review_required', channel_owner = 'human',
            next_action = 'human_review', next_action_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(timestamp, timestamp, command.leadId);
    database.sqlite
      .prepare("UPDATE conversations SET owner = 'human', updated_at = ? WHERE lead_id = ?")
      .run(timestamp, command.leadId);
    database.sqlite
      .prepare(`
        INSERT INTO exceptions (
          id, lead_id, type, severity, status, context_json, created_at
        ) VALUES (?, ?, 'ai_decision_rejected', 'warning', 'open', ?, ?)
      `)
      .run(randomUUID(), command.leadId, JSON.stringify({ reason }), timestamp);
    database.sqlite
      .prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type, entity_id, before_json, after_json,
          reason, correlation_id, created_at
        ) VALUES (?, 'system', 'ai_human_review', 'lead', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        command.leadId,
        JSON.stringify({ channelState: lead.channelState, channelOwner: lead.channelOwner }),
        JSON.stringify({ channelState: "human_review_required", channelOwner: "human" }),
        reason,
        command.correlationId,
        timestamp,
      );
  })();
  return { status: "human_review", reason };
}

function handleModelFailure(
  database: AppDatabase,
  command: HandleInboundCommand,
  error: unknown,
  now: Date,
): ConversationHandlingResult {
  if (error instanceof AiBudgetExhaustedError) {
    return { status: "ai_paused", reason: "openai_budget_exhausted" };
  }
  const reason = error instanceof Error ? error.message : String(error);
  recordIntegrationFailure(database, "openai", "invalid_ai_output", now, 1);
  return moveToHumanReview(database, command, `invalid_ai_output:${reason.slice(0, 200)}`, now);
}

function updateNextAction(
  database: AppDatabase,
  leadId: string,
  nextAction: string | null,
  nextActionAt: string | null,
  now: Date,
): void {
  database.sqlite
    .prepare("UPDATE leads SET next_action = ?, next_action_at = ?, updated_at = ? WHERE id = ?")
    .run(nextAction, nextActionAt, now.toISOString(), leadId);
}
