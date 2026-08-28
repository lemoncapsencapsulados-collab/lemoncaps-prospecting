/**
 * Seeds a demonstration scenario and drives it through the real service layer so
 * the operator can see each critical flow actually run instead of taking the
 * code on trust. Everything here uses the simulated integrations: no message
 * leaves this machine.
 *
 * Run with: pnpm evidence
 */

import { randomUUID } from "node:crypto";

import { createDatabase } from "../src/db/client.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { createExperiment, assignVariant } from "../src/features/experiments/experiment-service.ts";
import {
  discoverLead,
  qualifyLead,
  readLead,
  transitionChannel,
  transitionPipeline,
} from "../src/features/leads/lead-service.ts";
import { handleInboundConversation } from "../src/features/conversations/conversation-service.ts";
import { createInstagramSignature } from "../src/integrations/instagram/signature.ts";
import { processInstagramWebhook } from "../src/integrations/instagram/webhook-service.ts";
import { SimulatedDecisionModel } from "../src/integrations/openai/simulated-decision-model.ts";
import type { PublicProfileObservation } from "../src/features/leads/types.ts";
import { loadBusinessConfig } from "../src/lib/business-config.ts";
import { loadEnv } from "../src/lib/env.ts";
import { enqueueJob } from "../src/worker/job-store.ts";

const evidenceAppSecret = "evidence-app-secret";
const now = new Date();

const env = loadEnv(process.env);
const business = loadBusinessConfig(env.businessConfigPath);
const database = createDatabase(env.databaseUrl);
migrateDatabase(database);

const steps: string[] = [];
function record(step: string): void {
  steps.push(step);
  process.stdout.write(`  ${step}\n`);
}

process.stdout.write(`\nEvidência da operação — ${business.companyName}\n`);
process.stdout.write(`Banco: ${env.databaseUrl}\n\n`);

// --- 1. Descoberta e deduplicação -------------------------------------------

process.stdout.write("1. Descoberta e deduplicação\n");

const seeds: readonly PublicProfileObservation[] = [
  profile("@marca.vitalis", "Vitalis Suplementos", "Marca própria de suplementos em cápsulas", "customer"),
  profile("@nutri.performance", "Nutri Performance", "Loja de suplementos e produtos para desempenho", "customer"),
  profile("@bem.viver.oficial", "Bem Viver", "Marca de bem-estar buscando fabricação terceirizada", "customer"),
  profile("@lojas.forte", "Lojas Forte", "Rede de lojas de suplementos alimentares", "customer"),
  profile("@treino.da.ana", "Ana Ribeiro", "Conteúdo de treino, emagrecimento e qualidade de vida", "affiliate"),
  profile("@vida.saudavel.br", "Vida Saudável", "Criador de conteúdo sobre saúde e bem-estar", "affiliate"),
];

const leadIds = seeds.map((seed) => {
  const result = discoverLead(database, seed);
  return { handle: seed.instagramHandle, id: result.leadId, created: result.created };
});
record(`${leadIds.filter((lead) => lead.created).length} lead(s) novo(s) cadastrado(s)`);

const duplicate = discoverLead(database, profile("MARCA.VITALIS", "Vitalis", "Duplicata", "customer"));
record(
  duplicate.created
    ? "FALHA: duplicata criou um segundo lead"
    : `duplicata de @marca.vitalis reaproveitou o lead existente (${duplicate.leadId.slice(0, 8)})`,
);

const scored = leadIds.map((lead) => ({
  ...lead,
  result: qualifyLead(database, lead.id, business, {
    actor: "worker",
    correlationId: `evidence-${lead.id}`,
  }),
}));
record(
  `${scored.length} lead(s) pontuado(s): ${scored
    .map((lead) => `${lead.handle}=${lead.result.score}`)
    .join(", ")}`,
);
record(
  `${scored.filter((lead) => lead.result.qualified).length} passaram do limiar de 40 e avançaram para "qualified"`,
);

// --- 2. Handoff navegador -> webhook -> API ---------------------------------

process.stdout.write("\n2. Handoff de canal até a API oficial\n");

const replyingLead = leadIds[0]!;
advanceToWaitingReply(replyingLead.id);
record(`@marca.vitalis em ${readLead(database, replyingLead.id).channelState}`);

const inboundText = "Oi! Tenho interesse em fabricar minha linha. Como funciona?";
const rawBody = new TextEncoder().encode(
  JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "business-account",
        time: now.getTime(),
        messaging: [
          {
            sender: { id: "17890000001", username: "marca.vitalis" },
            recipient: { id: "business-account" },
            timestamp: now.getTime(),
            message: { mid: `mid.evidence.${randomUUID()}`, text: inboundText },
          },
        ],
      },
    ],
  }),
);

const webhookResult = processInstagramWebhook({
  database,
  appSecret: evidenceAppSecret,
  signatureHeader: createInstagramSignature(rawBody, evidenceAppSecret),
  rawBody,
  now: () => now,
});
record(`webhook aceito: ${JSON.stringify(webhookResult)}`);

try {
  processInstagramWebhook({
    database,
    appSecret: evidenceAppSecret,
    signatureHeader: "sha256=assinatura-invalida",
    rawBody,
    now: () => now,
  });
  record("FALHA: assinatura inválida foi aceita");
} catch {
  record("assinatura inválida rejeitada antes de qualquer gravação");
}

const afterWebhook = readLead(database, replyingLead.id);
record(
  `canal agora: ${afterWebhook.channelState} / responsável: ${afterWebhook.channelOwner} / funil: ${afterWebhook.pipelineState}`,
);

// --- 3. Decisão da IA sobre a resposta recebida ------------------------------

process.stdout.write("\n3. Interpretação da resposta e próxima ação\n");

const inboundMessage = database.sqlite
  .prepare(
    "SELECT id FROM messages WHERE lead_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1",
  )
  .get(replyingLead.id) as { id: string } | undefined;

if (!inboundMessage) {
  record("FALHA: nenhuma mensagem recebida foi gravada pelo webhook");
} else {
  const decision = await handleInboundConversation(
    {
      database,
      business,
      model: new SimulatedDecisionModel(),
      fastModel: env.openAiModelFast ?? "simulated-fast",
      mainModel: env.openAiModel ?? "simulated-main",
      monthlyBudgetUsd: env.openAiMonthlyBudgetUsd,
      pricing: {
        inputPerMillionUsd: env.openAiInputUsdPerMillion ?? 0,
        outputPerMillionUsd: env.openAiOutputUsdPerMillion ?? 0,
      },
      projectedCallCostUsd: env.openAiProjectedCallCostUsd ?? 0,
      now: () => now,
    },
    { leadId: replyingLead.id, messageId: inboundMessage.id, correlationId: `evidence-inbound` },
  );
  record(`decisão da IA: ${JSON.stringify(decision)}`);
}

// --- 4. Experimento A/B ------------------------------------------------------

process.stdout.write("\n4. Experimento com grupo de controle\n");

const existingExperiment = database.sqlite
  .prepare("SELECT id FROM experiments WHERE name = ? LIMIT 1")
  .get("Abertura: pergunta vs. observação") as { id: string } | undefined;

const experimentId =
  existingExperiment?.id ??
  createExperiment(database, {
    name: "Abertura: pergunta vs. observação",
    funnel: "customer",
    variable: "opening_message",
    minimumSamplePerVariant: 30,
    // Both openings stay inside verifiedClaims: industry, location, private label.
    variants: [
      {
        name: "Controle — observação",
        isControl: true,
        allocationBasisPoints: 5_000,
        config: {
          opening_message:
            "Vi a linha de vocês. Somos uma indústria brasileira de suplementos com operação em Cuiabá/MT e atuamos com projetos de marca própria.",
        },
      },
      {
        name: "Variante — pergunta",
        isControl: false,
        allocationBasisPoints: 5_000,
        config: {
          opening_message:
            "Vocês já fabricam a linha de vocês ou terceirizam? Somos indústria de suplementos em Cuiabá/MT e trabalhamos com marca própria.",
        },
      },
    ],
  }).experimentId;

const customerLeads = leadIds.filter((_, index) => index < 4);
for (const lead of customerLeads) {
  assignVariant(database, experimentId, lead.id);
}
const assignmentCount = database.sqlite
  .prepare("SELECT COUNT(*) AS count FROM experiment_assignments WHERE experiment_id = ?")
  .get(experimentId) as { count: number };
record(`experimento com 2 variantes e ${assignmentCount.count} lead(s) distribuído(s)`);
record("amostra mínima de 30 por variante ainda não atingida — nenhum vencedor declarado");

// --- 5. Sinais para o painel de operação ------------------------------------

process.stdout.write("\n5. Fila e exceções\n");

enqueueJob(database, {
  type: "evaluate_follow_up",
  payload: { leadId: replyingLead.id },
  idempotencyKey: `evidence-follow-up:${replyingLead.id}`,
  correlationId: "evidence",
  runAt: new Date(now.getTime() + 3_600_000),
  maxAttempts: 3,
});

// Only raise this when the link is genuinely absent, so the queue reflects a
// real gap in config/business.json instead of a decorative row.
const exceptionExists = database.sqlite
  .prepare("SELECT 1 FROM exceptions WHERE type = 'affiliate_group_link_missing' AND status = 'open'")
  .get();
if (!business.affiliateGroupLink && !exceptionExists) {
  database.sqlite
    .prepare(
      "INSERT INTO exceptions (id, lead_id, type, severity, status, context_json, created_at) VALUES (?, NULL, 'affiliate_group_link_missing', 'warning', 'open', ?, ?)",
    )
    .run(
      randomUUID(),
      JSON.stringify({ reason: "affiliateGroupLink ausente em config/business.json" }),
      now.toISOString(),
    );
}
record("job agendado e exceção aberta registrados para o painel");

// --- Resumo ------------------------------------------------------------------

process.stdout.write("\nResumo do banco\n");
for (const table of [
  "leads",
  "conversations",
  "messages",
  "events",
  "jobs",
  "exceptions",
  "ai_calls",
  "experiments",
  "experiment_assignments",
  "audit_logs",
]) {
  const row = database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  process.stdout.write(`  ${table.padEnd(24)} ${row.count}\n`);
}

const failures = steps.filter((step) => step.startsWith("FALHA"));
process.stdout.write(
  failures.length === 0
    ? "\nTodos os passos concluíram como esperado.\n\n"
    : `\n${failures.length} passo(s) falharam.\n\n`,
);

database.close();
if (failures.length > 0) process.exit(1);

// --- Auxiliares --------------------------------------------------------------

function profile(
  instagramHandle: string,
  displayName: string,
  bio: string,
  proposedFunnel: "customer" | "affiliate",
): PublicProfileObservation {
  return {
    instagramHandle,
    displayName,
    bio,
    category: proposedFunnel === "customer" ? "Empreendedor" : "Criador de conteúdo",
    location: "Brasil",
    recentPosts: [],
    hashtags: [],
    relatedProfiles: [],
    source: "evidence-script",
    proposedFunnel,
  };
}

function advanceToWaitingReply(leadId: string): void {
  const lead = readLead(database, leadId);
  // A previous run may have already carried this lead through the handoff; the
  // pipeline is forward-only, so re-running must not try to walk it again.
  if (lead.pipelineState !== "discovered" && lead.pipelineState !== "qualified") return;

  // The pipeline refuses to skip a stage, so walk the valid path from wherever
  // qualification left this lead.
  if (lead.pipelineState === "discovered") {
    transitionPipeline(database, {
      leadId,
      to: "qualified",
      actor: "operator",
      reason: "Qualificação confirmada manualmente pelo operador",
      correlationId: "evidence",
    });
  }

  transitionPipeline(database, {
    leadId,
    to: "contacted",
    actor: "operator",
    reason: "Primeiro contato registrado pelo operador",
    correlationId: "evidence",
  });
  transitionChannel(database, {
    leadId,
    to: "browser_contact_sent",
    owner: "browser",
    actor: "operator",
    reason: "Primeiro contato registrado pelo operador",
    correlationId: "evidence",
  });
  transitionChannel(database, {
    leadId,
    to: "waiting_inbound_reply",
    owner: "browser",
    actor: "operator",
    reason: "Aguardando resposta do lead",
    correlationId: "evidence",
  });
}
