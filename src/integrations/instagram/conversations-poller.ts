import { createHash } from "node:crypto";

import { z } from "zod";

import type { AppDatabase } from "@/db/client";
import type { IntegrationMode } from "@/lib/env";
import { recordIntegrationFailure, recordIntegrationSuccess } from "@/worker/circuit-breaker";

import { ingestInboundMessage, type IngestOutcome } from "./webhook-service.ts";

/**
 * Pulls recent conversations from the Graph API instead of waiting to be pushed.
 *
 * Meta only delivers real webhook events to a published app, so polling is the
 * ingestion path available before publication. Both paths funnel into
 * `ingestInboundMessage`, and Meta's message id deduplicates across them — a
 * message already handled by the webhook is skipped here, and the reverse.
 */

const messageSchema = z.object({
  id: z.string().trim().min(1),
  from: z.object({ id: z.string().trim().min(1), username: z.string().trim().optional() }).optional(),
  message: z.string().optional(),
  created_time: z.string().optional(),
});

const conversationsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        messages: z.object({ data: z.array(messageSchema) }).optional(),
      }),
    )
    .default([]),
});

export interface PollDependencies {
  readonly database: AppDatabase;
  readonly mode: IntegrationMode;
  readonly accessToken?: string;
  readonly businessAccountId?: string;
  readonly apiVersion: string;
  readonly messagesPerConversation?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface PollResult {
  readonly status: "polled" | "skipped";
  readonly reason?: string;
  readonly conversations: number;
  readonly accepted: number;
  readonly duplicates: number;
  readonly unmatched: number;
  readonly ignored: number;
}

const emptyCounts = { conversations: 0, accepted: 0, duplicates: 0, unmatched: 0, ignored: 0 };

export async function pollInstagramConversations(
  dependencies: PollDependencies,
): Promise<PollResult> {
  const now = dependencies.now ?? (() => new Date());

  if (dependencies.mode === "simulated") {
    return { status: "skipped", reason: "instagram_simulated", ...emptyCounts };
  }
  if (!dependencies.accessToken || !dependencies.businessAccountId) {
    return { status: "skipped", reason: "instagram_not_configured", ...emptyCounts };
  }

  const limit = dependencies.messagesPerConversation ?? 10;
  const url =
    `https://graph.instagram.com/${dependencies.apiVersion}/me/conversations` +
    `?fields=messages.limit(${limit}){id,from,message,created_time}` +
    `&access_token=${encodeURIComponent(dependencies.accessToken)}`;

  const performFetch = dependencies.fetchImpl ?? fetch;
  let payload: unknown;
  try {
    const response = await performFetch(url, { method: "GET" });
    payload = await response.json();
    if (!response.ok) {
      throw new Error(describeGraphError(payload, response.status));
    }
  } catch (error) {
    recordIntegrationFailure(dependencies.database, "instagram", errorCode(error), now());
    throw error;
  }

  const parsed = conversationsSchema.parse(payload);
  const counts = { ...emptyCounts, conversations: parsed.data.length };

  for (const conversation of parsed.data) {
    for (const message of conversation.messages?.data ?? []) {
      const text = message.message?.trim();
      // Skip empty payloads (media-only) and anything the business account sent.
      if (!text || !message.from || message.from.id === dependencies.businessAccountId) {
        counts.ignored += 1;
        continue;
      }

      const outcome: IngestOutcome = ingestInboundMessage(
        dependencies.database,
        {
          externalId: message.id,
          senderId: message.from.id,
          senderUsername: message.from.username,
          text,
          timestamp: parseTimestamp(message.created_time, now()),
          source: "polling",
          payloadHash: createHash("sha256").update(`${message.id}:${text}`).digest("hex"),
        },
        now(),
      );
      counts[outcome === "duplicates" ? "duplicates" : outcome] += 1;
    }
  }

  recordIntegrationSuccess(dependencies.database, "instagram", now());
  return { status: "polled", ...counts };
}

function parseTimestamp(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function describeGraphError(payload: unknown, status: number): string {
  const message = (payload as { error?: { message?: string } } | null)?.error?.message;
  return message ? `instagram_poll_failed: ${message}` : `instagram_poll_failed: HTTP ${status}`;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : "instagram_poll_failed";
}
