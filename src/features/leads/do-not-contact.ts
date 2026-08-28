import { randomUUID } from "node:crypto";

import type { AppDatabase } from "@/db/client";

import { readLead } from "./lead-service.ts";

export interface OptOutInput {
  readonly leadId: string;
  readonly source: "instagram_inbound" | "operator" | "import";
  readonly reason: string;
  readonly correlationId: string;
}

export function optOutLead(database: AppDatabase, input: OptOutInput): void {
  database.sqlite.transaction(() => {
    const lead = readLead(database, input.leadId);
    const timestamp = new Date().toISOString();

    database.sqlite
      .prepare(`
        INSERT INTO do_not_contact (normalized_handle, lead_id, source, reason, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(normalized_handle) DO UPDATE SET
          lead_id = excluded.lead_id,
          source = excluded.source,
          reason = excluded.reason
      `)
      .run(lead.normalizedHandle, lead.id, input.source, input.reason, timestamp);
    database.sqlite
      .prepare(`
        UPDATE leads
        SET channel_state = 'do_not_contact', channel_owner = 'none', next_action = NULL,
            next_action_at = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(timestamp, lead.id);
    database.sqlite
      .prepare("UPDATE conversations SET owner = 'none', updated_at = ? WHERE lead_id = ?")
      .run(timestamp, lead.id);
    database.sqlite
      .prepare(`
        UPDATE jobs
        SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
            last_error = 'cancelled_by_opt_out', updated_at = ?
        WHERE status IN ('queued', 'running') AND json_extract(payload_json, '$.leadId') = ?
      `)
      .run(timestamp, lead.id);
    database.sqlite
      .prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type, entity_id, before_json, after_json,
          reason, correlation_id, created_at
        ) VALUES (?, 'system', 'opt_out', 'lead', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        lead.id,
        JSON.stringify({ channelOwner: lead.channelOwner, channelState: lead.channelState }),
        JSON.stringify({ channelOwner: "none", channelState: "do_not_contact" }),
        input.reason,
        input.correlationId,
        timestamp,
      );
    database.sqlite
      .prepare(`
        INSERT INTO events (id, lead_id, type, payload_json, correlation_id, created_at)
        VALUES (?, ?, 'lead.opted_out', ?, ?, ?)
      `)
      .run(randomUUID(), lead.id, JSON.stringify({ source: input.source }), input.correlationId, timestamp);
  })();
}
