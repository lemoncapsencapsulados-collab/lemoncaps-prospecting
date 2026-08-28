import type { BusinessConfig } from "@/lib/business-config";

export type ClaimsPolicyReason =
  | "unverified_claim"
  | "unconfigured_link"
  | "unsupported_numeric_claim";

export type ClaimsPolicyResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: ClaimsPolicyReason };

const urlPattern = /https?:\/\/[^\s<>"']+/giu;
const numericClaimPattern = /(?:r\$\s*\d|\b\d+(?:[.,]\d+)?\s*%|\b\d+(?:[.,]\d+)?\b)/iu;
const fixedHighRiskClaims = [
  "resultado garantido",
  "resultados garantidos",
  "cura doencas",
  "tratamento de doencas",
  "prevencao de doencas",
  "melhor produto do mercado",
  "eficacia clinica",
];

export function enforceClaimsPolicy(text: string, business: BusinessConfig): ClaimsPolicyResult {
  const normalized = normalizePolicyText(text);
  const forbiddenClaims = [...business.unverifiedClaims, ...fixedHighRiskClaims].map(normalizePolicyText);
  if (forbiddenClaims.some((claim) => claim.length > 0 && normalized.includes(claim))) {
    return { allowed: false, reason: "unverified_claim" };
  }

  const urls = extractUrls(text);
  const allowedUrls = new Set(
    [business.companyWebsite, business.whatsappLink, business.affiliateGroupLink]
      .filter((value): value is string => Boolean(value))
      .map(normalizeUrl),
  );
  if (urls.some((url) => !allowedUrls.has(normalizeUrl(url)))) {
    return { allowed: false, reason: "unconfigured_link" };
  }

  const textWithoutUrls = text.replace(urlPattern, " ");
  if (numericClaimPattern.test(textWithoutUrls)) {
    return { allowed: false, reason: "unsupported_numeric_claim" };
  }

  return { allowed: true };
}

export function normalizePolicyText(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim()
    .replaceAll(/\s+/gu, " ");
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(urlPattern)].map((match) => match[0].replace(/[),.;!?]+$/u, ""));
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.href;
}
