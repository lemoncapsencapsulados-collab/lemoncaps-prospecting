import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

const nullableHttpUrl = z.union([z.url(), z.null()]);

export const businessConfigSchema = z.object({
  ownerName: z.string().trim().min(1),
  ownerRole: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  companyWebsite: z.url(),
  instagramHandle: z.string().regex(/^@[A-Za-z0-9._]+$/),
  whatsappLink: nullableHttpUrl,
  affiliateGroupLink: nullableHttpUrl,
  oneLinePitch: z.string().trim().min(1),
  howItWorks: z.array(z.string().trim().min(1)).min(1),
  revenueModel: z.string().trim().min(1),
  marketJargon: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  verifiedClaims: z.array(z.string().trim().min(1)).min(1),
  unverifiedClaims: z.array(z.string().trim().min(1)),
  icpSegments: z.array(z.string().trim().min(1)).min(1),
  icpKeywords: z.array(z.string().trim().min(1)).min(1),
  affiliateTopics: z.array(z.string().trim().min(1)).min(1),
  geography: z.string().trim().min(1),
});

export type BusinessConfig = z.infer<typeof businessConfigSchema>;

export function loadBusinessConfig(path: string): BusinessConfig {
  const absolutePath = resolve(path);
  const source = readFileSync(absolutePath, "utf8");
  return businessConfigSchema.parse(JSON.parse(source));
}
