import type { BusinessConfig } from "@/lib/business-config";

import type { LeadRole, PublicProfileObservation } from "./types.ts";

export interface QualificationResult {
  readonly score: number;
  readonly qualified: boolean;
  readonly role: LeadRole;
  readonly keywordMatches: readonly string[];
  readonly topicMatches: readonly string[];
  readonly geographyMatch: boolean;
}

export function scoreProfile(
  profile: PublicProfileObservation,
  business: BusinessConfig,
): QualificationResult {
  const searchableText = normalizeSearchText(
    [
      profile.displayName,
      profile.bio,
      profile.category,
      profile.location,
      ...profile.recentPosts,
      ...profile.hashtags,
    ].join(" "),
  );
  const keywordMatches = business.icpKeywords.filter((keyword) =>
    searchableText.includes(normalizeSearchText(keyword)),
  );
  const topicMatches = business.affiliateTopics.filter((topic) =>
    searchableText.includes(normalizeSearchText(topic)),
  );
  const role = classifyRole(profile);
  const geographyMatch = geographyMatches(profile.location, business.geography);
  const roleScore = role === "owner" ? 25 : role === "decision_maker" ? 20 : role === "store" ? 10 : 0;
  const relevanceScore =
    profile.proposedFunnel === "customer" ? keywordMatches.length * 25 : topicMatches.length * 20;
  const score = Math.min(100, roleScore + relevanceScore + (geographyMatch ? 10 : 0));

  return {
    score,
    qualified: score >= 40,
    role,
    keywordMatches,
    topicMatches,
    geographyMatch,
  };
}

export function classifyRole(profile: PublicProfileObservation): LeadRole {
  const text = normalizeSearchText(`${profile.displayName} ${profile.bio} ${profile.category}`);
  if (/(fundador|fundadora|dono|dona|proprietario|proprietaria|socio|socia|ceo)/u.test(text)) return "owner";
  if (/(diretor|diretora|gerente|head|gestor|gestora)/u.test(text)) return "decision_maker";
  if (/(loja|store|shop|ecommerce|e-commerce)/u.test(text)) return "store";
  if (/(colaborador|colaboradora|funcionario|funcionaria|assistente)/u.test(text)) return "employee";
  return "unknown";
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function geographyMatches(location: string, configuredGeography: string): boolean {
  const normalizedLocation = normalizeSearchText(location);
  const normalizedGeography = normalizeSearchText(configuredGeography);
  return normalizedLocation.length > 0 && normalizedGeography.includes(normalizedLocation);
}
