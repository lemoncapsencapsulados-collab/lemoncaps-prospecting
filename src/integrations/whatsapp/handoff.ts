import type { Funnel } from "@/features/leads/types";
import type { BusinessConfig } from "@/lib/business-config";

export type HandoffDecision =
  | { readonly kind: "link"; readonly url: string }
  | {
      readonly kind: "human_review";
      readonly reason: "whatsapp_link_missing" | "affiliate_group_link_missing";
    };

export function resolveHandoff(config: BusinessConfig, funnel: Funnel): HandoffDecision {
  if (funnel === "customer") {
    return config.whatsappLink
      ? { kind: "link", url: config.whatsappLink }
      : { kind: "human_review", reason: "whatsapp_link_missing" };
  }
  return config.affiliateGroupLink
    ? { kind: "link", url: config.affiliateGroupLink }
    : { kind: "human_review", reason: "affiliate_group_link_missing" };
}
