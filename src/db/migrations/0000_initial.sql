CREATE TABLE leads (
  id TEXT PRIMARY KEY NOT NULL,
  instagram_handle TEXT NOT NULL,
  normalized_handle TEXT NOT NULL UNIQUE,
  funnel TEXT NOT NULL CHECK (funnel IN ('customer', 'affiliate')),
  pipeline_state TEXT NOT NULL,
  channel_state TEXT NOT NULL,
  channel_owner TEXT NOT NULL CHECK (channel_owner IN ('browser', 'api', 'human', 'none')),
  display_name TEXT,
  role TEXT,
  niche TEXT,
  source TEXT,
  public_profile_json TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  score_breakdown_json TEXT,
  next_action TEXT,
  next_action_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX leads_funnel_pipeline_idx ON leads (funnel, pipeline_state);
CREATE INDEX leads_next_action_idx ON leads (next_action_at);

CREATE TABLE lead_tags (
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (lead_id, tag)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  owner TEXT NOT NULL CHECK (owner IN ('browser', 'api', 'human', 'none')),
  meta_recipient_id TEXT UNIQUE,
  last_inbound_at TEXT,
  api_window_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel TEXT NOT NULL CHECK (channel IN ('browser', 'instagram_api', 'whatsapp', 'simulated')),
  body TEXT NOT NULL,
  external_id TEXT UNIQUE,
  variant_id TEXT,
  delivery_state TEXT NOT NULL,
  failure_reason TEXT,
  idempotency_key TEXT UNIQUE,
  sent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX messages_lead_created_idx ON messages (lead_id, created_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'dead_letter', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  run_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX jobs_due_idx ON jobs (status, run_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX events_lead_created_idx ON events (lead_id, created_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_entity_idx ON audit_logs (entity_type, entity_id, created_at);

CREATE TABLE do_not_contact (
  normalized_handle TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  funnel TEXT NOT NULL CHECK (funnel IN ('customer', 'affiliate')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  criteria_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE experiments (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  funnel TEXT NOT NULL CHECK (funnel IN ('customer', 'affiliate')),
  variable TEXT NOT NULL,
  minimum_sample_per_variant INTEGER NOT NULL CHECK (minimum_sample_per_variant > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'running', 'paused', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE experiment_variants (
  id TEXT PRIMARY KEY NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_control INTEGER NOT NULL DEFAULT 0 CHECK (is_control IN (0, 1)),
  allocation_basis_points INTEGER NOT NULL CHECK (allocation_basis_points BETWEEN 0 AND 10000),
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE experiment_assignments (
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, lead_id)
);

CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  estimated_cost_usd REAL NOT NULL CHECK (estimated_cost_usd >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX ai_calls_created_idx ON ai_calls (created_at);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE integration_health (
  integration TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  circuit_state TEXT NOT NULL CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE exceptions (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  context_json TEXT NOT NULL,
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX exceptions_status_idx ON exceptions (status, severity);

CREATE TABLE backups (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL,
  integrity_check TEXT NOT NULL,
  restore_tested_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE webhook_events (
  external_event_id TEXT PRIMARY KEY NOT NULL,
  payload_hash TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE TABLE system_mutexes (
  name TEXT PRIMARY KEY NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO integration_health (
  integration, status, circuit_state, consecutive_failures, updated_at
) VALUES
  ('browser', 'unknown', 'closed', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('instagram', 'unknown', 'closed', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('openai', 'unknown', 'closed', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO system_settings (key, value_json, updated_at) VALUES
  ('general_pause', '{"paused":false,"reason":null}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ai_pause', '{"paused":false,"reason":null}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
