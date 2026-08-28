import { readExperiments } from "@/features/dashboard/experiment-queries";
import { formatInteger, formatPercent, funnelLabels, labelFor, statusLabels } from "@/lib/labels";
import { getServerContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

export default function ExperimentsPage() {
  const { database } = getServerContext();
  const experiments = readExperiments(database);

  return (
    <>
      <header className="page-header">
        <h1>Experimentos</h1>
        <p>
          Uma variável por experimento, com grupo de controle e amostra mínima registrada. Nenhum vencedor é
          declarado antes de todas as variantes atingirem a amostra mínima.
        </p>
      </header>

      {experiments.length === 0 ? (
        <p className="empty">Nenhum experimento cadastrado.</p>
      ) : (
        <div className="stack">
          {experiments.map((experiment) => (
            <section className="card" key={experiment.id}>
              <div className="timeline-head">
                <strong>{experiment.name}</strong>
                <span className="badge badge-neutral">{labelFor(statusLabels, experiment.status)}</span>
              </div>
              <p className="muted" style={{ margin: "0.35rem 0 0.9rem" }}>
                {funnelLabels[experiment.funnel]} · variável testada:{" "}
                <span className="mono">{experiment.variable}</span> · amostra mínima:{" "}
                {formatInteger(experiment.minimumSamplePerVariant)} por variante
              </p>

              {experiment.conclusive ? (
                <div className="banner" data-tone="success" style={{ marginBottom: "0.9rem" }}>
                  <div>
                    <strong>Amostra mínima atingida em todas as variantes</strong>
                    <p>A comparação já pode orientar uma decisão.</p>
                  </div>
                </div>
              ) : (
                <div className="banner" data-tone="warning" style={{ marginBottom: "0.9rem" }}>
                  <div>
                    <strong>Amostra insuficiente</strong>
                    <p>Ainda não é possível declarar vencedor sem risco de conclusão precoce.</p>
                  </div>
                </div>
              )}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Variante</th>
                      <th className="numeric">Distribuição</th>
                      <th className="numeric">Amostra</th>
                      <th className="numeric">Score ponderado</th>
                      <th className="numeric">Score por lead</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experiment.variants.map((variant) => (
                      <tr key={variant.variantId}>
                        <td>
                          {variant.name}
                          {variant.isControl ? (
                            <>
                              {" "}
                              <span className="badge badge-neutral">Controle</span>
                            </>
                          ) : null}
                          {variant.variantId === experiment.leadingVariantId ? (
                            <>
                              {" "}
                              <span className="badge badge-success">À frente</span>
                            </>
                          ) : null}
                        </td>
                        <td className="numeric">{formatPercent(variant.allocationBasisPoints / 10_000)}</td>
                        <td className="numeric">{formatInteger(variant.assignments)}</td>
                        <td className="numeric">{formatInteger(variant.weightedScore)}</td>
                        <td className="numeric">{variant.scorePerAssignment.toFixed(2)}</td>
                        <td>
                          <span
                            className={
                              variant.reachedMinimumSample ? "badge badge-success" : "badge badge-warning"
                            }
                          >
                            {variant.reachedMinimumSample ? "Amostra atingida" : "Coletando"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
