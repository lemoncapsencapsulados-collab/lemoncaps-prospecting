import type {
  ChannelOwner,
  ChannelState,
  Funnel,
  PipelineState,
} from "@/features/leads/types";
import type { IntegrationMode } from "./env.ts";

/**
 * Portuguese labels for every internal English identifier surfaced in the panel.
 * Each map is keyed by its union type so a new state fails the type check until
 * it is translated here.
 */

export const funnelLabels: Readonly<Record<Funnel, string>> = {
  customer: "Clientes",
  affiliate: "Afiliados",
};

export const pipelineStateLabels: Readonly<Record<PipelineState, string>> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  contacted: "Abordado",
  replied: "Respondeu",
  interested: "Interessado",
  whatsapp_handoff: "Encaminhado ao WhatsApp",
  registered: "Cadastrado",
  active_customer: "Cliente ativo",
  joined_affiliate_group: "Entrou no grupo",
  active_affiliate: "Afiliado ativo",
  generated_customer: "Gerou cliente",
  closed: "Encerrado",
};

export const channelStateLabels: Readonly<Record<ChannelState, string>> = {
  browser_contact_pending: "Contato pendente",
  browser_contact_sent: "Contato enviado",
  waiting_inbound_reply: "Aguardando resposta",
  api_eligible: "Elegível para API",
  api_active: "API ativa",
  api_window_closed: "Janela encerrada",
  human_review_required: "Revisão humana",
  do_not_contact: "Não contatar",
  blocked: "Bloqueado",
  completed: "Concluído",
};

export const channelOwnerLabels: Readonly<Record<ChannelOwner, string>> = {
  browser: "Navegador",
  api: "API oficial",
  human: "Operador",
  none: "Nenhum",
};

export const integrationModeLabels: Readonly<Record<IntegrationMode, string>> = {
  simulated: "Simulado",
  dry_run: "Ensaio",
  live: "Ao vivo",
};

export const jobStatusLabels: Readonly<Record<string, string>> = {
  queued: "Na fila",
  running: "Executando",
  completed: "Concluído",
  dead_letter: "Falha definitiva",
  cancelled: "Cancelado",
};

export const severityLabels: Readonly<Record<string, string>> = {
  info: "Informação",
  warning: "Atenção",
  critical: "Crítico",
};

export const circuitStateLabels: Readonly<Record<string, string>> = {
  closed: "Fechado",
  open: "Aberto",
  half_open: "Meio aberto",
};

export const statusLabels: Readonly<Record<string, string>> = {
  draft: "Rascunho",
  active: "Ativo",
  running: "Em andamento",
  paused: "Pausado",
  completed: "Concluído",
  open: "Aberta",
  resolved: "Resolvida",
};

export const messageDirectionLabels: Readonly<Record<string, string>> = {
  inbound: "Recebida",
  outbound: "Enviada",
};

export const messageChannelLabels: Readonly<Record<string, string>> = {
  browser: "Navegador",
  instagram_api: "API do Instagram",
  whatsapp: "WhatsApp",
  simulated: "Simulado",
};

/** Falls back to the raw identifier so an unmapped value stays visible, never blank. */
export function labelFor(map: Readonly<Record<string, string>>, key: string): string {
  return map[key] ?? key;
}

export function formatDateTime(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

export function formatRelativeToNow(iso: string | null, now: Date): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMinutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  const absolute = Math.abs(diffMinutes);
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (absolute < 60) return formatter.format(diffMinutes, "minute");
  if (absolute < 60 * 24) return formatter.format(Math.round(diffMinutes / 60), "hour");
  return formatter.format(Math.round(diffMinutes / (60 * 24)), "day");
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}
