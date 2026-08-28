import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";
import type { BusinessConfig } from "@/lib/business-config";

import { scoreProfile, type QualificationResult } from "./qualification.ts";
import { canTransitionChannel, canTransitionPipeline } from "./states.ts";
import type {
  ChannelOwner,
  ChannelState,
  LeadRecord,
  PipelineState,
  PublicProfileObservation,
  TransitionContext,
} from "./types.ts";

interface LeadRow {
  id: string;
  instagram_handle: string;
  normalized_handle: string;
  funnel: "customer" | "affiliate";
  pipeline_state: PipelineState;
  channel_state: ChannelState;
  channel_owner: ChannelOwner;
  display_name: string | null;
  role: LeadRecord["role"];
  niche: string | null;
  source: string | null;
  public_profile_json: string;
  score: number;
  score_breakdown_json: string | null;
  next_action: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoverLeadResult {
  readonly leadId: string;
  readonly created: boolean;
  readonly suppressed: boolean;
}

export interface QualificationContext {
  readonly actor: TransitionContext["actor"];
  readonly correlationId: string;
}

export interface PipelineTransitionInput extends TransitionContext {
  readonly to: PipelineState;
}

export interface ChannelTransitionInput extends TransitionContext {
  readonly to: ChannelState;
  readonly owner: ChannelOwner;
}

export function normalizeInstagramHandle(handle: string): string {
  const normalized = handle.trim().replace(/^@/u, "").toLocaleLowerCase("en-US");
  if (!/^[a-z0-9._]+$/u.test(normalized)) throw new Error("Invalid Instagram handle");
  return normalized;
}

export function discoverLead(
  database: AppDatabase,
  observation: PublicProfileObservation,
): DiscoverLeadResult {
  const normalizedHandle = normalizeInstagramHandle(observation.instagramHandle);
  const existing = findLeadByNormalizedHandle(database, normalizedHandle);
  if (existing) {
    return {
      leadId: existing.id,
      created: false,
      suppressed: existing.channelState === "do_not_contact" || isSuppressed(database, normalizedHandle),
    };
  }

  return database.sqlite.transaction(() => {
    const concurrent = findLeadByNormalizedHandle(database, normalizedHandle);
    if (concurrent) {
      return {
        leadId: concurrent.id,
        created: false,
        suppressed: concurrent.channelState === "do_not_contact" || isSuppressed(database, normalizedHandle),
      };
    }

    const suppressed = isSuppressed(database, normalizedHandle);
    const leadId = randomUUID();
    const timestamp = new Date().toISOString();
    database.sqlite
      .prepare(`
        INSERT INTO leads (
          id, instagram_handle, normalized_handle, funnel, pipeline_state,
          channel_state, channel_owner, display_name, source, public_profile_json,
          score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'discovered', ?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .run(
        leadId,
        `@${normalizedHandle}`,
        normalizedHandle,
        observation.proposedFunnel,
        suppressed ? "do_not_contact" : "browser_contact_pending",
        suppressed ? "none" : "browser",
        observation.displayName,
        observation.source,
        JSON.stringify(observation),
        timestamp,
        timestamp,
      );
    appendEvent(database, leadId, "lead.discovered", { suppressed }, randomUUID(), timestamp);

    return { leadId, created: true, suppressed };
  })();
}

export function qualifyLead(
  database: AppDatabase,
  leadId: string,
  business: BusinessConfig,
  context: QualificationContext,
): QualificationResult {
  return database.sqlite.transaction(() => {
    const lead = readLead(database, leadId);
    const profile = JSON.parse(lead.publicProfileJson) as PublicProfileObservation;
    const result = scoreProfile(profile, business);
    const timestamp = new Date().toISOString();
    database.sqlite
      .prepare(`
        UPDATE leads
        SET score = ?, score_breakdown_json = ?, role = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(result.score, JSON.stringify(result), result.role, timestamp, leadId);

    if (result.qualified && lead.pipelineState === "discovered") {
      persistPipelineTransition(database, lead, "qualified", {
        leadId,
        actor: context.actor,
        reason: "ICP score reached qualification threshold",
        correlationId: context.correlationId,
      });
    }

    appendEvent(database, leadId, "lead.qualified", result, context.correlationId, timestamp);
    return result;
  })();
}

export function transitionPipeline(database: AppDatabase, input: PipelineTransitionInput): LeadRecord {
  return database.sqlite.transaction(() => {
    const lead = readLead(database, input.leadId);
    persistPipelineTransition(database, lead, input.to, input);
    return readLead(database, input.leadId);
  })();
}

export function transitionChannel(database: AppDatabase, input: ChannelTransitionInput): LeadRecord {
  return database.sqlite.transaction(() => {
    const lead = readLead(database, input.leadId);
    if (!canTransitionChannel(lead.channelState, input.to)) {
      throw new Error(`Invalid channel transition: ${lead.channelState} -> ${input.to}`);
    }

    const timestamp = new Date().toISOString();
    database.sqlite
      .prepare("UPDATE leads SET channel_state = ?, channel_owner = ?, updated_at = ? WHERE id = ?")
      .run(input.to, input.owner, timestamp, input.leadId);
    appendAudit(database, {
      actor: input.actor,
      action: "channel_transition",
      entityId: input.leadId,
      before: { channelOwner: lead.channelOwner, channelState: lead.channelState },
      after: { channelOwner: input.owner, channelState: input.to },
      reason: input.reason,
      correlationId: input.correlationId,
      timestamp,
    });
    appendEvent(database, input.leadId, "lead.channel_transitioned", { to: input.to }, input.correlationId, timestamp);
    return readLead(database, input.leadId);
  })();
}

export function readLead(database: AppDatabase, leadId: string): LeadRecord {
  const row = database.sqlite.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as LeadRow | undefined;
  if (!row) throw new Error(`Lead not found: ${leadId}`);
  return mapLeadRow(row);
}

function findLeadByNormalizedHandle(database: AppDatabase, normalizedHandle: string): LeadRecord | null {
  const row = database.sqlite
    .prepare("SELECT * FROM leads WHERE normalized_handle = ?")
    .get(normalizedHandle) as LeadRow | undefined;
  return row ? mapLeadRow(row) : null;
}

function isSuppressed(database: AppDatabase, normalizedHandle: string): boolean {
  return Boolean(
    database.sqlite
      .prepare("SELECT 1 FROM do_not_contact WHERE normalized_handle = ?")
      .get(normalizedHandle),
  );
}

function persistPipelineTransition(
  database: AppDatabase,
  lead: LeadRecord,
  to: PipelineState,
  context: TransitionContext,
): void {
  if (!canTransitionPipeline(lead.funnel, lead.pipelineState, to)) {
    throw new Error(`Invalid ${lead.funnel} pipeline transition: ${lead.pipelineState} -> ${to}`);
  }

  const timestamp = new Date().toISOString();
  database.sqlite
    .prepare("UPDATE leads SET pipeline_state = ?, updated_at = ? WHERE id = ?")
    .run(to, timestamp, lead.id);
  appendAudit(database, {
    actor: context.actor,
    action: "pipeline_transition",
    entityId: lead.id,
    before: { pipelineState: lead.pipelineState },
    after: { pipelineState: to },
    reason: context.reason,
    correlationId: context.correlationId,
    timestamp,
  });
  appendEvent(database, lead.id, "lead.pipeline_transitioned", { to }, context.correlationId, timestamp);
}

interface AuditInput {
  readonly actor: string;
  readonly action: string;
  readonly entityId: string;
  readonly before: object;
  readonly after: object;
  readonly reason: string;
  readonly correlationId: string;
  readonly timestamp: string;
}

function appendAudit(database: AppDatabase, input: AuditInput): void {
  database.sqlite
    .prepare(`
      INSERT INTO audit_logs (
        id, actor, action, entity_type, entity_id, before_json, after_json,
        reason, correlation_id, created_at
      ) VALUES (?, ?, ?, 'lead', ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.actor,
      input.action,
      input.entityId,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.reason,
      input.correlationId,
      input.timestamp,
    );
}

function appendEvent(
  database: AppDatabase,
  leadId: string,
  type: string,
  payload: object,
  correlationId: string,
  timestamp: string,
): void {
  database.sqlite
    .prepare(`
      INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(randomUUID(), leadId, type, JSON.stringify(payload), correlationId, timestamp);
}

function mapLeadRow(row: LeadRow): LeadRecord {
  return {
    id: row.id,
    instagramHandle: row.instagram_handle,
    normalizedHandle: row.normalized_handle,
    funnel: row.funnel,
    pipelineState: row.pipeline_state,
    channelState: row.channel_state,
    channelOwner: row.channel_owner,
    displayName: row.display_name,
    role: row.role,
    niche: row.niche,
    source: row.source,
    publicProfileJson: row.public_profile_json,
    score: row.score,
    scoreBreakdownJson: row.score_breakdown_json,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
