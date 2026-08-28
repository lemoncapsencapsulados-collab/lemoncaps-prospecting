import Link from "next/link";

import {
  readAiCostSummary,
  readFunnelSummary,
  readIntegrationHealth,
  readOperationSnapshot,
  type FunnelSummary,
} from "@/features/dashboard/queries";
import { funnelToSlug } from "@/features/dashboard/funnel-slug";
import {
  circuitStateLabels,
  formatDateTime,
  formatInteger,
  formatPercent,
  formatUsd,
  funnelLabels,
  integrationModeLabels,
  labelFor,
  pipelineStateLabels,
} from "@/lib/labels";
import { getServerContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Stages that mean the funnel paid off, coloured apart from work in progress. */
const wonStates = new Set(["active_customer", "generated_customer"]);

interface AttentionItem {
  readonly tone: "danger" | "warning";
  readonly title: string;
  readonly detail: string;
  readonly href: string;
}

export default function DashboardPage() {
  const { database, env, business } = getServerContext();
  const now = new Date();

  const operation = readOperationSnapshot(database, now);
  const cost = readAiCostSummary(database, env.openAiMonthlyBudgetUsd, now);
  const summaries = [readFunnelSummary(database, "customer"), readFunnelSummary(database, "affiliate")];
  const health = readIntegrationHealth(database);

  const attention: AttentionItem[] = [];
  if (operation.criticalExceptions > 0) {
    attention.push({
      tone: "danger",
      title: `${formatInteger(operation.criticalExceptions)} exceção(ões) crítica(s)`,
      detail: "Resolva antes de retomar os envios.",
      href: "/operacao",
    });
  }
  if (operation.deadLetterJobs > 0) {
    attention.push({
      tone: "danger",
      title: `${formatInteger(operation.deadLetterJobs)} trabalho(s) em falha definitiva`,
      detail: "Esgotaram as tentativas e pararam sozinhos.",
      href: "/operacao",
    });
  }
  if (operation.overdueFollowUps > 0) {
    attention.push({
      tone: "warning",
      title: `${formatInteger(operation.overdueFollowUps)} follow-up(s) vencido(s)`,
      detail: "A hora prevista de retomar o contato já passou.",
      href: "/operacao",
    });
  }
  if (cost.budgetUsedRatio >= 0.8) {
    attention.push({
      tone: "warning",
      title: `Orçamento de IA em ${formatPercent(cost.budgetUsedRatio)}`,
      detail: "O sistema pausa sozinho ao atingir o teto.",
      href: "/configuracao",
    });
  }

  const queued = operation.jobCounts.queued ?? 0;
  const totalLeads = summaries.reduce((sum, summary) => sum + summary.total, 0);

  return (
    <>
      <header className="page-header">
        <h1>Visão geral</h1>
        <p>
          {business.companyName} · atendimento de {env.operatingHours} ({env.operatingTimezone})
        </p>
      </header>

      <dl className="statusline">
        <div>
          <dt>Operação</dt>
          <dd>
            <span className={operation.paused ? "led led-hold" : "led led-steady"} />
            {operation.paused ? "Pausada" : "Ativa"}
          </dd>
        </div>
        <div>
          <dt>Na fila</dt>
          <dd>
            <span className={queued > 0 ? "led led-steady" : "led led-off"} />
            {formatInteger(queued)} trabalho(s)
          </dd>
        </div>
        <div>
          <dt>API Instagram</dt>
          <dd>
            <span className={env.instagramMode === "live" ? "led led-steady" : "led led-off"} />
            {integrationModeLabels[env.instagramMode]}
          </dd>
        </div>
        <div>
          <dt>Motor de IA</dt>
          <dd>
            <span className={env.anthropicApiKey || env.openAiApiKey ? "led led-steady" : "led led-off"} />
            {env.aiProvider === "anthropic" ? "Claude" : "OpenAI"}
          </dd>
        </div>
        <div>
          <dt>Gasto no mês</dt>
          <dd>
            <span className={cost.budgetUsedRatio >= 0.8 ? "led led-critical" : "led led-off"} />
            {formatUsd(cost.monthlySpendUsd)}
          </dd>
        </div>
      </dl>

      {attention.length === 0 ? (
        <p className="empty">Nada precisa de você agora.</p>
      ) : (
        <div>
          {attention.map((item) => (
            <Link className="banner" data-tone={item.tone} href={item.href} key={item.title}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <h2>Funis</h2>
      {totalLeads === 0 ? (
        <p className="empty">
          Nenhum lead ainda. Eles entram sozinhos quando alguém responde ao seu conteúdo no Instagram.
        </p>
      ) : (
        <div className="stack">
          {summaries.map((summary) => (
            <FunnelCard key={summary.funnel} summary={summary} />
          ))}
        </div>
      )}

      <h2>Custo de IA</h2>
      <div className="metric-grid">
        <div className="card">
          <p className="metric-label">Por lead</p>
          <p className="metric-value">
            {cost.costPerLeadUsd === null ? "—" : formatUsd(cost.costPerLeadUsd)}
          </p>
          <p className="metric-hint">{formatInteger(cost.leadCount)} lead(s) no total</p>
        </div>
        <div className="card">
          <p className="metric-label">Por cliente ativo</p>
          <p className="metric-value">
            {cost.costPerActiveCustomerUsd === null ? "—" : formatUsd(cost.costPerActiveCustomerUsd)}
          </p>
          <p className="metric-hint">{formatInteger(cost.activeCustomerCount)} cliente(s) ativo(s)</p>
        </div>
        <div className="card">
          <p className="metric-label">Mês corrente</p>
          <p className="metric-value">{formatUsd(cost.monthlySpendUsd)}</p>
          <p className="metric-hint">
            {formatPercent(cost.budgetUsedRatio)} do teto de {formatUsd(cost.monthlyBudgetUsd)}
          </p>
        </div>
        <div className="card">
          <p className="metric-label">Chamadas</p>
          <p className="metric-value">{formatInteger(cost.callCount)}</p>
          <p className="metric-hint">Decisões tomadas neste mês</p>
        </div>
      </div>

      {health.length > 0 ? (
        <>
          <h2>Integrações</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Integração</th>
                  <th>Circuito</th>
                  <th className="numeric">Falhas seguidas</th>
                  <th>Último sucesso</th>
                  <th>Última falha</th>
                </tr>
              </thead>
              <tbody>
                {health.map((row) => (
                  <tr key={row.integration}>
                    <td className="mono">{row.integration}</td>
                    <td>
                      <span
                        className={
                          row.circuitState === "closed" ? "badge badge-success" : "badge badge-danger"
                        }
                      >
                        {labelFor(circuitStateLabels, row.circuitState)}
                      </span>
                    </td>
                    <td className="numeric">{formatInteger(row.consecutiveFailures)}</td>
                    <td>{formatDateTime(row.lastSuccessAt, env.operatingTimezone)}</td>
                    <td>{formatDateTime(row.lastFailureAt, env.operatingTimezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

function FunnelCard({ summary }: { readonly summary: FunnelSummary }) {
  return (
    <section className="card">
      <div className="timeline-head">
        <strong>{funnelLabels[summary.funnel]}</strong>
        <Link className="badge" href={`/funis/${funnelToSlug[summary.funnel]}`}>
          {formatInteger(summary.total)} · abrir
        </Link>
      </div>

      <div className="stage-rule">
        {summary.stages.map((stage) => (
          <div
            className="stage"
            key={stage.state}
            data-filled={stage.count > 0}
            data-won={wonStates.has(stage.state)}
          >
            <span className="stage-name">{pipelineStateLabels[stage.state]}</span>
            <span className="stage-count">{formatInteger(stage.count)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
