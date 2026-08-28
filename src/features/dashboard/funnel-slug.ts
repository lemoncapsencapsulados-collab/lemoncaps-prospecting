import type { Funnel } from "@/features/leads/types";

/** Routes are Portuguese; the funnel identifier stays English internally. */
const slugToFunnel: Readonly<Record<string, Funnel>> = {
  clientes: "customer",
  afiliados: "affiliate",
};

export const funnelToSlug: Readonly<Record<Funnel, string>> = {
  customer: "clientes",
  affiliate: "afiliados",
};

export function funnelFromSlug(slug: string): Funnel | null {
  return slugToFunnel[slug] ?? null;
}
