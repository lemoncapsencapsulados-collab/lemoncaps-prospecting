import Link from "next/link";
import {
  readAiCostSummary,
  readFunnelSummary,
  readIntegrationHealth,
  readOperationSnapshot,
} from "@/features/dashboard/queries";
import type { Funnel } from "@/features/leads/types";
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

const funnelSlugs: Readonly<Record<Funnel, string>> = {
  customer: "clientes",
  affiliate: "afiliados",
};

export default function DashboardPage() {
  const { database, env, business } = getServerContext();
  const now = new Date();

  const operation = readOperationSnapshot(database, now);
  const cost = readAiCostSummary(database, env.openAiMonthlyBudgetUsd, now);
  const summaries = [readFunnelSummary(database, "customer"), readFunnelSummary(database, "affiliate")];
  const health = readIntegrationHealth(database);

  return (
    <>
      <header className="page-header">
        <h1>Visão geral</h1>
        <p>
          Operação de prospecção da {business.companyName}. Horário de funcionamento {env.operatingHours} (
          {env.operatingTimezone}).
        </p>
      </header>

      {operation.paused ? (
        <div className="banner" data-tone="warning" role="status">
          <div>
            <strong>Operação pausada</strong>
            <p>Nenhum envio será realizado enquanto a pausa geral estiver ativa.</p>
          </div>
        </div>
      ) : (
        <div className="banner" data-tone="success" role="status">
          <div>
            <strong>Operação ativa</strong>
            <p>O worker está autorizado a processar a fila dentro dos limites configurados.</p>
          </div>
        </div>
      )}

      {operation.criticalExceptions > 0 ? (
        <div className="banner" data-tone="danger" role="alert">
          <div>
            <strong>{formatInteger(operation.criticalExceptions)} exceção(ões) crítica(s) em aberto</strong>
            <p>Revise a fila de exceções antes de retomar os envios.</p>
          </div>
        </div>
      ) : null}

      {operation.deadLetterJobs > 0 ? (
        <div className="banner" data-tone="danger" role="alert">
          <div>
            <strong>{formatInteger(operation.deadLetterJobs)} job(s) em falha definitiva</strong>
            <p>Esses trabalhos esgotaram as tentativas e exigem intervenção do operador.</p>
          </div>
        </div>
      ) : null}

      <h2>Custo de inteligência artificial</h2>
      <div className="metric-grid">
        <div className="card metric">
          <p className="metric-label">Gasto no mês</p>
          <p className="metric-value">{formatUsd(cost.monthlySpendUsd)}</p>
          <p className="metric-hint">
            {formatPercent(cost.budgetUsedRatio)} do teto de {formatUsd(cost.monthlyBudgetUsd)}
          </p>
        </div>
        <div className="card metric">
          <p className="metric-label">Custo por lead</p>
          <p className="metric-value">
            {cost.costPerLeadUsd === null ? "—" : formatUsd(cost.costPerLeadUsd)}
          </p>
          <p className="metric-hint">{formatInteger(cost.leadCount)} lead(s) cadastrado(s)</p>
        </div>
        <div className="card metric">
          <p className="metric-label">Custo por cliente ativo</p>
          <p className="metric-value">
            {cost.costPerActiveCustomerUsd === null ? "—" : formatUsd(cost.costPerActiveCustomerUsd)}
          </p>
          <p className="metric-hint">{formatInteger(cost.activeCustomerCount)} cliente(s) ativo(s)</p>
        </div>
        <div className="card metric">
          <p className="metric-label">Chamadas de IA</p>
          <p className="metric-value">{formatInteger(cost.callCount)}</p>
          <p className="metric-hint">No mês corrente</p>
        </div>
      </div>

      <h2>Funis</h2>
      <div className="stack">
        {summaries.map((summary) => (
          <section className="card" key={summary.funnel}>
            <div className="timeline-head">
              <strong>{funnelLabels[summary.funnel]}</strong>
              <Link className="badge" href={`/funis/${funnelSlugs[summary.funnel]}`}>
                Abrir Kanban
              </Link>
            </div>
            {summary.total === 0 ? (
              <p className="muted" style={{ marginBottom: 0 }}>
                Nenhum lead neste funil ainda.
              </p>
            ) : (
              <div className="table-wrap" style={{ marginTop: "0.85rem" }}>
                <table>
                  <thead>
                    <tr>
                      {summary.stages.map((stage) => (
                        <th className="numeric" key={stage.state}>
                          {pipelineStateLabels[stage.state]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {summary.stages.map((stage) => (
                        <td className="numeric" key={stage.state}>
                          {formatInteger(stage.count)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>

      <h2>Integrações</h2>
      <div className="metric-grid">
        <div className="card metric">
          <p className="metric-label">Navegador</p>
          <p className="metric-value" style={{ fontSize: "1.25rem" }}>
            {integrationModeLabels[env.browserMode]}
          </p>
          <p className="metric-hint">
            {env.browserLiveAuthorized ? "Autorizado para envio real" : "Envio real não autorizado"}
          </p>
        </div>
        <div className="card metric">
          <p className="metric-label">API do Instagram</p>
          <p className="metric-value" style={{ fontSize: "1.25rem" }}>
            {integrationModeLabels[env.instagramMode]}
          </p>
          <p className="metric-hint">
            {env.instagramLiveAuthorized ? "Autorizada para envio real" : "Envio real não autorizado"}
          </p>
        </div>
      </div>

      {health.length > 0 ? (
        <div className="table-wrap" style={{ marginTop: "0.9rem" }}>
          <table>
            <thead>
              <tr>
                <th>Integração</th>
                <th>Situação</th>
                <th>Circuito</th>
                <th className="numeric">Falhas seguidas</th>
                <th>Último sucesso</th>
                <th>Última falha</th>
              </tr>
            </thead>
            <tbody>
              {health.map((row) => (
                <tr key={row.integration}>
                  <td>{row.integration}</td>
                  <td>{row.status}</td>
                  <td>
                    <span
                      className={row.circuitState === "closed" ? "badge badge-success" : "badge badge-danger"}
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
      ) : (
        <p className="empty" style={{ marginTop: "0.9rem" }}>
          Nenhuma integração registrou atividade ainda.
        </p>
      )}
    </>
  );
}
