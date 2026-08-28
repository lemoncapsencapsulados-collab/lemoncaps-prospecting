import Link from "next/link";
import { funnelToSlug } from "@/features/dashboard/funnel-slug";
import {
  readOpenExceptions,
  readOperationSnapshot,
  readOverdueFollowUps,
  readRecentJobs,
} from "@/features/dashboard/queries";
import {
  formatDateTime,
  formatInteger,
  formatRelativeToNow,
  funnelLabels,
  jobStatusLabels,
  labelFor,
  severityLabels,
} from "@/lib/labels";
import { getServerContext } from "@/lib/server-context";

import { toggleGeneralPause } from "./actions.ts";

export const dynamic = "force-dynamic";

const severityTone: Readonly<Record<string, string>> = {
  critical: "badge badge-danger",
  warning: "badge badge-warning",
  info: "badge badge-neutral",
};

const jobStatusTone: Readonly<Record<string, string>> = {
  dead_letter: "badge badge-danger",
  running: "badge",
  queued: "badge badge-neutral",
  completed: "badge badge-success",
  cancelled: "badge badge-neutral",
};

export default function OperationsPage() {
  const { database, env } = getServerContext();
  const now = new Date();
  const timeZone = env.operatingTimezone;

  const snapshot = readOperationSnapshot(database, now);
  const jobs = readRecentJobs(database);
  const exceptions = readOpenExceptions(database);
  const followUps = readOverdueFollowUps(database, now);

  return (
    <>
      <header className="page-header">
        <h1>Operação</h1>
        <p>Fila de trabalhos, exceções abertas, follow-ups vencidos e controle de pausa geral.</p>
      </header>

      <section className="card">
        <div className="timeline-head" style={{ marginBottom: "0.85rem" }}>
          <strong>Pausa geral</strong>
          <span className={snapshot.paused ? "badge badge-warning" : "badge badge-success"}>
            {snapshot.paused ? "Pausado" : "Ativo"}
          </span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {snapshot.paused
            ? "Nenhum envio será realizado enquanto a pausa estiver ativa. A retomada é registrada no log de auditoria."
            : "O worker está autorizado a processar a fila. A pausa interrompe todos os envios imediatamente."}
        </p>
        <form action={toggleGeneralPause} className="pause-form">
          <input type="hidden" name="paused" value={snapshot.paused ? "false" : "true"} />
          <button className={snapshot.paused ? undefined : "danger"} type="submit">
            {snapshot.paused ? "Retomar operação" : "Pausar tudo"}
          </button>
        </form>
      </section>

      <h2>Resumo</h2>
      <div className="metric-grid">
        <div className="card metric">
          <p className="metric-label">Na fila</p>
          <p className="metric-value">{formatInteger(snapshot.jobCounts.queued ?? 0)}</p>
        </div>
        <div className="card metric">
          <p className="metric-label">Falha definitiva</p>
          <p className="metric-value">{formatInteger(snapshot.deadLetterJobs)}</p>
        </div>
        <div className="card metric">
          <p className="metric-label">Exceções abertas</p>
          <p className="metric-value">{formatInteger(snapshot.openExceptions)}</p>
          <p className="metric-hint">{formatInteger(snapshot.criticalExceptions)} crítica(s)</p>
        </div>
        <div className="card metric">
          <p className="metric-label">Follow-ups vencidos</p>
          <p className="metric-value">{formatInteger(snapshot.overdueFollowUps)}</p>
        </div>
      </div>

      <h2>Fila de trabalhos</h2>
      {jobs.length === 0 ? (
        <p className="empty">Nenhum trabalho registrado.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Situação</th>
                <th className="numeric">Tentativas</th>
                <th>Agendado para</th>
                <th>Último erro</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="mono">{job.type}</td>
                  <td>
                    <span className={labelFor(jobStatusTone, job.status)}>
                      {labelFor(jobStatusLabels, job.status)}
                    </span>
                  </td>
                  <td className="numeric">
                    {formatInteger(job.attempts)} / {formatInteger(job.maxAttempts)}
                  </td>
                  <td>{formatDateTime(job.runAt, timeZone)}</td>
                  <td className="muted">{job.lastError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Fila de exceções</h2>
      {exceptions.length === 0 ? (
        <p className="empty">Nenhuma exceção aberta.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Gravidade</th>
                <th>Lead</th>
                <th>Contexto</th>
                <th>Registrada em</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((exception) => (
                <tr key={exception.id}>
                  <td className="mono">{exception.type}</td>
                  <td>
                    <span className={labelFor(severityTone, exception.severity)}>
                      {labelFor(severityLabels, exception.severity)}
                    </span>
                  </td>
                  <td>
                    {exception.leadId ? <Link href={`/leads/${exception.leadId}`}>Abrir lead</Link> : "—"}
                  </td>
                  <td className="mono muted">{exception.context}</td>
                  <td>{formatDateTime(exception.createdAt, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Follow-ups vencidos</h2>
      {followUps.length === 0 ? (
        <p className="empty">Nenhum follow-up vencido.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Funil</th>
                <th>Ação prevista</th>
                <th>Venceu</th>
              </tr>
            </thead>
            <tbody>
              {followUps.map((followUp) => (
                <tr key={followUp.id}>
                  <td>
                    <Link href={`/leads/${followUp.id}`}>{followUp.instagramHandle}</Link>
                  </td>
                  <td>
                    <Link href={`/funis/${funnelToSlug[followUp.funnel]}`}>{funnelLabels[followUp.funnel]}</Link>
                  </td>
                  <td>{followUp.nextAction ?? "—"}</td>
                  <td>
                    {formatRelativeToNow(followUp.nextActionAt, now)}
                    <br />
                    <span className="muted">{formatDateTime(followUp.nextActionAt, timeZone)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
