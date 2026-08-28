import Link from "next/link";
import { notFound } from "next/navigation";

import { funnelFromSlug } from "@/features/dashboard/funnel-slug";
import { readKanban } from "@/features/dashboard/queries";
import {
  channelStateLabels,
  formatDateTime,
  formatInteger,
  funnelLabels,
  pipelineStateLabels,
} from "@/lib/labels";
import { getServerContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly funnel: string }>;
}

export default async function FunnelPage({ params }: PageProps) {
  const { funnel: slug } = await params;
  const funnel = funnelFromSlug(slug);
  if (!funnel) notFound();

  const { database, env } = getServerContext();
  const columns = readKanban(database, funnel);
  const total = columns.reduce((sum, column) => sum + column.total, 0);

  return (
    <>
      <header className="page-header">
        <h1>Funil de {funnelLabels[funnel].toLowerCase()}</h1>
        <p>
          {formatInteger(total)} lead(s) no funil. As colunas seguem os estados de pipeline; o estado de canal
          aparece como etiqueta em cada cartão.
        </p>
      </header>

      {total === 0 ? (
        <p className="empty">
          Nenhum lead neste funil ainda. Assim que a descoberta ou a importação cadastrar perfis, eles aparecem
          aqui.
        </p>
      ) : (
        <div className="kanban">
          {columns.map((column) => (
            <section className="kanban-column" key={column.state}>
              <header className="kanban-column-header">
                <span>{pipelineStateLabels[column.state]}</span>
                <span>{formatInteger(column.total)}</span>
              </header>

              {column.cards.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.82rem", padding: "0 0.2rem" }}>
                  Vazio
                </p>
              ) : (
                column.cards.map((card) => (
                  <Link className="kanban-card" href={`/leads/${card.id}`} key={card.id}>
                    <strong>{card.displayName ?? card.instagramHandle}</strong>
                    <span className="handle">{card.instagramHandle}</span>
                    <div className="kanban-card-meta">
                      <span className="badge badge-neutral">{channelStateLabels[card.channelState]}</span>
                      <span className="score">{formatInteger(card.score)}</span>
                    </div>
                    {card.nextActionAt ? (
                      <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>
                        Próxima ação: {formatDateTime(card.nextActionAt, env.operatingTimezone)}
                      </p>
                    ) : null}
                  </Link>
                ))
              )}

              {column.total > column.cards.length ? (
                <p className="muted" style={{ fontSize: "0.8rem", padding: "0 0.2rem" }}>
                  + {formatInteger(column.total - column.cards.length)} não exibido(s)
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
