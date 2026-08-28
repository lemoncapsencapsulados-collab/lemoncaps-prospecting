import type { AppDatabase } from "@/db/client";
import {
  affiliatePipelineStates,
  customerPipelineStates,
  type ChannelState,
  type Funnel,
  type PipelineState,
} from "@/features/leads/types";

export interface FunnelStageCount {
  readonly state: PipelineState;
  readonly count: number;
}

export interface FunnelSummary {
  readonly funnel: Funnel;
  readonly total: number;
  readonly stages: readonly FunnelStageCount[];
}

export function pipelineStatesFor(funnel: Funnel): readonly PipelineState[] {
  return funnel === "customer" ? customerPipelineStates : affiliatePipelineStates;
}

export function readFunnelSummary(database: AppDatabase, funnel: Funnel): FunnelSummary {
  const rows = database.sqlite
    .prepare("SELECT pipeline_state, COUNT(*) AS count FROM leads WHERE funnel = ? GROUP BY pipeline_state")
    .all(funnel) as { pipeline_state: PipelineState; count: number }[];

  const counts = new Map(rows.map((row) => [row.pipeline_state, row.count]));
  const stages = pipelineStatesFor(funnel).map((state) => ({
    state,
    count: counts.get(state) ?? 0,
  }));

  return {
    funnel,
    total: rows.reduce((sum, row) => sum + row.count, 0),
    stages,
  };
}

export interface AiCostSummary {
  readonly monthlySpendUsd: number;
  readonly monthlyBudgetUsd: number;
  readonly budgetUsedRatio: number;
  readonly callCount: number;
  readonly leadCount: number;
  readonly activeCustomerCount: number;
  readonly costPerLeadUsd: number | null;
  readonly costPerActiveCustomerUsd: number | null;
}

export function readAiCostSummary(
  database: AppDatabase,
  monthlyBudgetUsd: number,
  now: Date,
): AiCostSummary {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const spend = database.sqlite
    .prepare(
      "SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total, COUNT(*) AS calls FROM ai_calls WHERE created_at >= ?",
    )
    .get(monthStart) as { total: number; calls: number };
  const leads = database.sqlite.prepare("SELECT COUNT(*) AS count FROM leads").get() as { count: number };
  const activeCustomers = database.sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM leads WHERE pipeline_state IN ('active_customer', 'generated_customer')",
    )
    .get() as { count: number };

  return {
    monthlySpendUsd: spend.total,
    monthlyBudgetUsd,
    budgetUsedRatio: monthlyBudgetUsd > 0 ? spend.total / monthlyBudgetUsd : 0,
    callCount: spend.calls,
    leadCount: leads.count,
    activeCustomerCount: activeCustomers.count,
    costPerLeadUsd: leads.count > 0 ? spend.total / leads.count : null,
    costPerActiveCustomerUsd: activeCustomers.count > 0 ? spend.total / activeCustomers.count : null,
  };
}

export interface OperationSnapshot {
  readonly paused: boolean;
  readonly jobCounts: Readonly<Record<string, number>>;
  readonly openExceptions: number;
  readonly criticalExceptions: number;
  readonly overdueFollowUps: number;
  readonly deadLetterJobs: number;
}

export function readOperationSnapshot(database: AppDatabase, now: Date): OperationSnapshot {
  const jobRows = database.sqlite
    .prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status")
    .all() as { status: string; count: number }[];
  const exceptions = database.sqlite
    .prepare(
      "SELECT COUNT(*) AS open_count, SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical_count FROM exceptions WHERE status = 'open'",
    )
    .get() as { open_count: number; critical_count: number | null };
  const overdue = database.sqlite
    .prepare("SELECT COUNT(*) AS count FROM leads WHERE next_action_at IS NOT NULL AND next_action_at <= ?")
    .get(now.toISOString()) as { count: number };

  const jobCounts = Object.fromEntries(jobRows.map((row) => [row.status, row.count]));

  return {
    paused: readGeneralPause(database),
    jobCounts,
    openExceptions: exceptions.open_count,
    criticalExceptions: exceptions.critical_count ?? 0,
    overdueFollowUps: overdue.count,
    deadLetterJobs: jobCounts.dead_letter ?? 0,
  };
}

/** Mirrors the worker's fail-safe reading: a missing or unreadable row means paused. */
export function readGeneralPause(database: AppDatabase): boolean {
  const row = database.sqlite
    .prepare("SELECT value_json FROM system_settings WHERE key = 'general_pause'")
    .get() as { value_json: string } | undefined;
  if (!row) return true;
  try {
    return (JSON.parse(row.value_json) as { paused?: unknown }).paused !== false;
  } catch {
    return true;
  }
}

export interface KanbanCard {
  readonly id: string;
  readonly instagramHandle: string;
  readonly displayName: string | null;
  readonly niche: string | null;
  readonly score: number;
  readonly channelState: ChannelState;
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly updatedAt: string;
}

export interface KanbanColumn {
  readonly state: PipelineState;
  readonly cards: readonly KanbanCard[];
  readonly total: number;
}

interface KanbanRow {
  id: string;
  instagram_handle: string;
  display_name: string | null;
  niche: string | null;
  score: number;
  pipeline_state: PipelineState;
  channel_state: ChannelState;
  next_action: string | null;
  next_action_at: string | null;
  updated_at: string;
}

const cardsPerColumn = 25;

export function readKanban(database: AppDatabase, funnel: Funnel): readonly KanbanColumn[] {
  const rows = database.sqlite
    .prepare(
      "SELECT id, instagram_handle, display_name, niche, score, pipeline_state, channel_state, next_action, next_action_at, updated_at FROM leads WHERE funnel = ? ORDER BY score DESC, updated_at DESC",
    )
    .all(funnel) as KanbanRow[];

  return pipelineStatesFor(funnel).map((state) => {
    const matching = rows.filter((row) => row.pipeline_state === state);
    return {
      state,
      total: matching.length,
      cards: matching.slice(0, cardsPerColumn).map(toKanbanCard),
    };
  });
}

function toKanbanCard(row: KanbanRow): KanbanCard {
  return {
    id: row.id,
    instagramHandle: row.instagram_handle,
    displayName: row.display_name,
    niche: row.niche,
    score: row.score,
    channelState: row.channel_state,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
    updatedAt: row.updated_at,
  };
}

export interface TimelineEntry {
  readonly at: string;
  readonly kind: "message" | "event" | "audit";
  readonly title: string;
  readonly detail: string;
  readonly meta: string | null;
}

export interface LeadDetailRecord {
  readonly id: string;
  readonly instagram_handle: string;
  readonly funnel: Funnel;
  readonly pipeline_state: PipelineState;
  readonly channel_state: ChannelState;
  readonly channel_owner: string;
  readonly display_name: string | null;
  readonly role: string | null;
  readonly niche: string | null;
  readonly source: string | null;
  readonly public_profile_json: string;
  readonly score: number;
  readonly next_action: string | null;
  readonly next_action_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LeadDetail {
  readonly lead: LeadDetailRecord;
  readonly tags: readonly string[];
  readonly timeline: readonly TimelineEntry[];
  readonly conversation: {
    readonly owner: string;
    readonly lastInboundAt: string | null;
    readonly apiWindowExpiresAt: string | null;
  } | null;
}

export function readLeadDetail(database: AppDatabase, leadId: string): LeadDetail | null {
  const lead = database.sqlite.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | LeadDetailRecord
    | undefined;
  if (!lead) return null;

  const tags = (
    database.sqlite.prepare("SELECT tag FROM lead_tags WHERE lead_id = ? ORDER BY tag").all(leadId) as {
      tag: string;
    }[]
  ).map((row) => row.tag);

  const conversationRow = database.sqlite
    .prepare("SELECT owner, last_inbound_at, api_window_expires_at FROM conversations WHERE lead_id = ?")
    .get(leadId) as
    | { owner: string; last_inbound_at: string | null; api_window_expires_at: string | null }
    | undefined;

  return {
    lead,
    tags,
    timeline: readTimeline(database, leadId),
    conversation: conversationRow
      ? {
          owner: conversationRow.owner,
          lastInboundAt: conversationRow.last_inbound_at,
          apiWindowExpiresAt: conversationRow.api_window_expires_at,
        }
      : null,
  };
}

function readTimeline(database: AppDatabase, leadId: string): readonly TimelineEntry[] {
  const messages = database.sqlite
    .prepare(
      "SELECT direction, channel, body, delivery_state, failure_reason, created_at FROM messages WHERE lead_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .all(leadId) as {
    direction: string;
    channel: string;
    body: string;
    delivery_state: string;
    failure_reason: string | null;
    created_at: string;
  }[];

  const events = database.sqlite
    .prepare(
      "SELECT type, payload_json, created_at FROM events WHERE lead_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .all(leadId) as { type: string; payload_json: string; created_at: string }[];

  const audits = database.sqlite
    .prepare(
      "SELECT actor, action, reason, created_at FROM audit_logs WHERE entity_type = 'lead' AND entity_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .all(leadId) as { actor: string; action: string; reason: string; created_at: string }[];

  const entries: TimelineEntry[] = [
    ...messages.map((row) => ({
      at: row.created_at,
      kind: "message" as const,
      title: row.direction === "inbound" ? "Mensagem recebida" : "Mensagem enviada",
      detail: row.body,
      meta: row.failure_reason ? `${row.delivery_state} — ${row.failure_reason}` : row.delivery_state,
    })),
    ...events.map((row) => ({
      at: row.created_at,
      kind: "event" as const,
      title: row.type,
      detail: row.payload_json,
      meta: null,
    })),
    ...audits.map((row) => ({
      at: row.created_at,
      kind: "audit" as const,
      title: row.action,
      detail: row.reason,
      meta: row.actor,
    })),
  ];

  return entries.sort((left, right) => right.at.localeCompare(left.at));
}

export interface JobRow {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runAt: string;
  readonly lastError: string | null;
}

export function readRecentJobs(database: AppDatabase, limit = 50): readonly JobRow[] {
  const rows = database.sqlite
    .prepare(
      "SELECT id, type, status, attempts, max_attempts, run_at, last_error FROM jobs ORDER BY CASE status WHEN 'dead_letter' THEN 0 WHEN 'running' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, updated_at DESC LIMIT ?",
    )
    .all(limit) as {
    id: string;
    type: string;
    status: string;
    attempts: number;
    max_attempts: number;
    run_at: string;
    last_error: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    lastError: row.last_error,
  }));
}

export interface ExceptionRow {
  readonly id: string;
  readonly leadId: string | null;
  readonly type: string;
  readonly severity: string;
  readonly status: string;
  readonly context: string;
  readonly createdAt: string;
}

export function readOpenExceptions(database: AppDatabase, limit = 50): readonly ExceptionRow[] {
  const rows = database.sqlite
    .prepare(
      "SELECT id, lead_id, type, severity, status, context_json, created_at FROM exceptions WHERE status = 'open' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT ?",
    )
    .all(limit) as {
    id: string;
    lead_id: string | null;
    type: string;
    severity: string;
    status: string;
    context_json: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    context: row.context_json,
    createdAt: row.created_at,
  }));
}

export interface OverdueFollowUp {
  readonly id: string;
  readonly instagramHandle: string;
  readonly funnel: Funnel;
  readonly nextAction: string | null;
  readonly nextActionAt: string;
}

export function readOverdueFollowUps(
  database: AppDatabase,
  now: Date,
  limit = 50,
): readonly OverdueFollowUp[] {
  const rows = database.sqlite
    .prepare(
      "SELECT id, instagram_handle, funnel, next_action, next_action_at FROM leads WHERE next_action_at IS NOT NULL AND next_action_at <= ? ORDER BY next_action_at ASC LIMIT ?",
    )
    .all(now.toISOString(), limit) as {
    id: string;
    instagram_handle: string;
    funnel: Funnel;
    next_action: string | null;
    next_action_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    instagramHandle: row.instagram_handle,
    funnel: row.funnel,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
  }));
}

export interface IntegrationHealthRow {
  readonly integration: string;
  readonly status: string;
  readonly circuitState: string;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastErrorCode: string | null;
}

export function readIntegrationHealth(database: AppDatabase): readonly IntegrationHealthRow[] {
  const rows = database.sqlite
    .prepare(
      "SELECT integration, status, circuit_state, consecutive_failures, last_success_at, last_failure_at, last_error_code FROM integration_health ORDER BY integration",
    )
    .all() as {
    integration: string;
    status: string;
    circuit_state: string;
    consecutive_failures: number;
    last_success_at: string | null;
    last_failure_at: string | null;
    last_error_code: string | null;
  }[];

  return rows.map((row) => ({
    integration: row.integration,
    status: row.status,
    circuitState: row.circuit_state,
    consecutiveFailures: row.consecutive_failures,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastErrorCode: row.last_error_code,
  }));
}
