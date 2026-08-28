import type { AppDatabase } from "@/db/client";

export type InstagramSendBlockReason =
  | "lead_not_found"
  | "do_not_contact"
  | "channel_not_api_eligible"
  | "channel_owner_mismatch"
  | "conversation_not_found"
  | "conversation_owner_mismatch"
  | "recipient_not_bound"
  | "no_inbound_message"
  | "api_window_expired"
  | "instagram_unavailable"
  | "general_pause";

export type InstagramSendPolicyDecision =
  | {
      readonly allowed: true;
      readonly conversationId: string;
      readonly recipientId: string;
      readonly windowExpiresAt: string;
    }
  | { readonly allowed: false; readonly reason: InstagramSendBlockReason };

interface PolicyRow {
  id: string;
  normalized_handle: string;
  channel_state: string;
  channel_owner: string;
  conversation_id: string | null;
  conversation_owner: string | null;
  meta_recipient_id: string | null;
  last_inbound_at: string | null;
  api_window_expires_at: string | null;
}

export function evaluateInstagramSendPolicy(
  database: AppDatabase,
  leadId: string,
  now: Date,
): InstagramSendPolicyDecision {
  const row = database.sqlite
    .prepare(`
      SELECT
        l.id, l.normalized_handle, l.channel_state, l.channel_owner,
        c.id AS conversation_id, c.owner AS conversation_owner,
        c.meta_recipient_id, c.last_inbound_at, c.api_window_expires_at
      FROM leads l
      LEFT JOIN conversations c ON c.lead_id = l.id
      WHERE l.id = ?
    `)
    .get(leadId) as PolicyRow | undefined;
  if (!row) return { allowed: false, reason: "lead_not_found" };

  const suppressed = database.sqlite
    .prepare("SELECT 1 FROM do_not_contact WHERE normalized_handle = ?")
    .get(row.normalized_handle);
  if (row.channel_state === "do_not_contact" || suppressed) {
    return { allowed: false, reason: "do_not_contact" };
  }
  if (row.channel_state !== "api_eligible" && row.channel_state !== "api_active") {
    return { allowed: false, reason: "channel_not_api_eligible" };
  }
  if (row.channel_owner !== "api") return { allowed: false, reason: "channel_owner_mismatch" };
  if (!row.conversation_id) return { allowed: false, reason: "conversation_not_found" };
  if (row.conversation_owner !== "api") {
    return { allowed: false, reason: "conversation_owner_mismatch" };
  }
  if (!row.meta_recipient_id) return { allowed: false, reason: "recipient_not_bound" };
  if (!row.last_inbound_at || !hasInboundMessage(database, leadId)) {
    return { allowed: false, reason: "no_inbound_message" };
  }
  if (!row.api_window_expires_at || now.getTime() >= Date.parse(row.api_window_expires_at)) {
    return { allowed: false, reason: "api_window_expired" };
  }
  if (isPaused(database)) return { allowed: false, reason: "general_pause" };
  if (!isInstagramHealthy(database)) {
    return { allowed: false, reason: "instagram_unavailable" };
  }

  return {
    allowed: true,
    conversationId: row.conversation_id,
    recipientId: row.meta_recipient_id,
    windowExpiresAt: row.api_window_expires_at,
  };
}

function hasInboundMessage(database: AppDatabase, leadId: string): boolean {
  return Boolean(
    database.sqlite
      .prepare("SELECT 1 FROM messages WHERE lead_id = ? AND direction = 'inbound' LIMIT 1")
      .get(leadId),
  );
}

function isPaused(database: AppDatabase): boolean {
  const row = database.sqlite
    .prepare("SELECT value_json FROM system_settings WHERE key = 'general_pause'")
    .get() as { value_json: string } | undefined;
  if (!row) return true;
  try {
    const value = JSON.parse(row.value_json) as { paused?: unknown };
    return value.paused !== false;
  } catch {
    return true;
  }
}

function isInstagramHealthy(database: AppDatabase): boolean {
  const row = database.sqlite
    .prepare("SELECT status, circuit_state FROM integration_health WHERE integration = 'instagram'")
    .get() as { status: string; circuit_state: string } | undefined;
  return row?.status === "healthy" && row.circuit_state === "closed";
}
