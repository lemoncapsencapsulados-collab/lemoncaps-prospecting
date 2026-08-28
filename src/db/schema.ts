import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    instagramHandle: text("instagram_handle").notNull(),
    normalizedHandle: text("normalized_handle").notNull(),
    funnel: text("funnel", { enum: ["customer", "affiliate"] }).notNull(),
    pipelineState: text("pipeline_state").notNull(),
    channelState: text("channel_state").notNull(),
    channelOwner: text("channel_owner", { enum: ["browser", "api", "human", "none"] }).notNull(),
    displayName: text("display_name"),
    role: text("role"),
    niche: text("niche"),
    source: text("source"),
    publicProfileJson: text("public_profile_json").notNull(),
    score: integer("score").notNull().default(0),
    scoreBreakdownJson: text("score_breakdown_json"),
    nextAction: text("next_action"),
    nextActionAt: text("next_action_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("leads_normalized_handle_unique").on(table.normalizedHandle),
    index("leads_funnel_pipeline_idx").on(table.funnel, table.pipelineState),
    index("leads_next_action_idx").on(table.nextActionAt),
    check("leads_score_range", sql`${table.score} BETWEEN 0 AND 100`),
  ],
);

export const leadTags = sqliteTable(
  "lead_tags",
  {
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [primaryKey({ columns: [table.leadId, table.tag] })],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    owner: text("owner", { enum: ["browser", "api", "human", "none"] }).notNull(),
    metaRecipientId: text("meta_recipient_id"),
    lastInboundAt: text("last_inbound_at"),
    apiWindowExpiresAt: text("api_window_expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("conversations_lead_unique").on(table.leadId),
    uniqueIndex("conversations_meta_recipient_unique").on(table.metaRecipientId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    channel: text("channel", { enum: ["browser", "instagram_api", "whatsapp", "simulated"] }).notNull(),
    body: text("body").notNull(),
    externalId: text("external_id"),
    variantId: text("variant_id"),
    deliveryState: text("delivery_state").notNull(),
    failureReason: text("failure_reason"),
    idempotencyKey: text("idempotency_key"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("messages_external_id_unique").on(table.externalId),
    uniqueIndex("messages_idempotency_key_unique").on(table.idempotencyKey),
    index("messages_lead_created_idx").on(table.leadId, table.createdAt),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "dead_letter", "cancelled"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: text("run_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: text("correlation_id").notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("jobs_idempotency_key_unique").on(table.idempotencyKey),
    index("jobs_due_idx").on(table.status, table.runAt),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    correlationId: text("correlation_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("events_lead_created_idx").on(table.leadId, table.createdAt)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    reason: text("reason").notNull(),
    correlationId: text("correlation_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("audit_entity_idx").on(table.entityType, table.entityId, table.createdAt)],
);

export const doNotContact = sqliteTable("do_not_contact", {
  normalizedHandle: text("normalized_handle").primaryKey(),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  source: text("source").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
});

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  funnel: text("funnel", { enum: ["customer", "affiliate"] }).notNull(),
  status: text("status", { enum: ["draft", "active", "paused", "completed"] }).notNull(),
  criteriaJson: text("criteria_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  funnel: text("funnel", { enum: ["customer", "affiliate"] }).notNull(),
  variable: text("variable").notNull(),
  minimumSamplePerVariant: integer("minimum_sample_per_variant").notNull(),
  status: text("status", { enum: ["draft", "running", "paused", "completed"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const experimentVariants = sqliteTable(
  "experiment_variants",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isControl: integer("is_control", { mode: "boolean" }).notNull().default(false),
    allocationBasisPoints: integer("allocation_basis_points").notNull(),
    configJson: text("config_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [check("variant_allocation_range", sql`${table.allocationBasisPoints} BETWEEN 0 AND 10000`)],
);

export const experimentAssignments = sqliteTable(
  "experiment_assignments",
  {
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => experimentVariants.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    assignedAt: text("assigned_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.experimentId, table.leadId] })],
);

export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estimatedCostUsd: real("estimated_cost_usd").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("ai_calls_created_idx").on(table.createdAt)],
);

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const integrationHealth = sqliteTable("integration_health", {
  integration: text("integration").primaryKey(),
  status: text("status").notNull(),
  circuitState: text("circuit_state", { enum: ["closed", "open", "half_open"] }).notNull(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  lastErrorCode: text("last_error_code"),
  updatedAt: text("updated_at").notNull(),
});

export const exceptions = sqliteTable(
  "exceptions",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull(),
    contextJson: text("context_json").notNull(),
    resolution: text("resolution"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [index("exceptions_status_idx").on(table.status, table.severity)],
);

export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  integrityCheck: text("integrity_check").notNull(),
  restoreTestedAt: text("restore_tested_at"),
  createdAt: text("created_at").notNull(),
});

export const webhookEvents = sqliteTable("webhook_events", {
  externalEventId: text("external_event_id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  processedAt: text("processed_at").notNull(),
});

export const systemMutexes = sqliteTable("system_mutexes", {
  name: text("name").primaryKey(),
  leaseOwner: text("lease_owner").notNull(),
  leaseExpiresAt: text("lease_expires_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
