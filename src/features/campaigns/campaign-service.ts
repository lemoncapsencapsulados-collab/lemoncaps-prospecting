import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AppDatabase } from "@/db/client";

const campaignInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    funnel: z.enum(["customer", "affiliate"]),
    criteria: z.record(z.string(), z.unknown()),
  })
  .strict();

export type CreateCampaignInput = z.infer<typeof campaignInputSchema>;

export interface CreateCampaignResult {
  readonly campaignId: string;
  readonly status: "draft";
}

export function createCampaign(
  database: AppDatabase,
  input: CreateCampaignInput,
): CreateCampaignResult {
  const parsed = campaignInputSchema.parse(input);
  const campaignId = randomUUID();
  const timestamp = new Date().toISOString();
  database.sqlite
    .prepare(`
      INSERT INTO campaigns (
        id, name, funnel, status, criteria_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'draft', ?, ?, ?)
    `)
    .run(
      campaignId,
      parsed.name,
      parsed.funnel,
      JSON.stringify(parsed.criteria),
      timestamp,
      timestamp,
    );
  return { campaignId, status: "draft" };
}
