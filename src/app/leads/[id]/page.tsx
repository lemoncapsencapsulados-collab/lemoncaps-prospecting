import Link from "next/link";
import { notFound } from "next/navigation";

import { funnelToSlug } from "@/features/dashboard/funnel-slug";
import { readLeadDetail } from "@/features/dashboard/queries";
import type { PublicProfileObservation } from "@/features/leads/types";
import {
  channelOwnerLabels,
  channelStateLabels,
  formatDateTime,
  formatInteger,
  funnelLabels,
  labelFor,
  pipelineStateLabels,
} from "@/lib/labels";
import { getServerContext } from "@/lib/server-context";

import { OptionalLink } from "@/app/_components/optional-link";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function LeadPage({ params }: PageProps) {
  const { id } = await params;
  const { database, env, business } = getServerContext();
  const detail = readLeadDetail(database, id);
  if (!detail) notFound();

  const { lead, tags, timeline, conversation } = detail;
  const profile = parseProfile(lead.public_profile_json);
  const timeZone = env.operatingTimezone;
  const affiliateGroupLink = business.affiliateGroupLink;
  const instagramUrl = `https://instagram.com/${lead.instagram_handle.replace(/^@/, "")}`;

  return (
    <>
      <header className="page-header">
        <h1>{lead.display_name ?? lead.instagram_handle}</h1>
        <p>
          {lead.instagram_handle} · {funnelLabels[lead.funnel]} ·{" "}
          <Link href={`/funis/${funnelToSlug[lead.funnel]}`}>voltar ao funil</Link>
        </p>
      </header>

      {lead.channel_state === "do_not_contact" ? (
        <div className="banner" data-tone="danger" role="alert">
          <div>
            <strong>Perfil na lista de não contato</strong>
            <p>Nenhum envio é permitido por qualquer canal, sem exceção e sem reentrada por outra campanha.</p>
          </div>
        </div>
      ) : null}

      <section className="card">
        <dl className="definitions">
          <div>
            <dt>Estado do funil</dt>
            <dd>{pipelineStateLabels[lead.pipeline_state]}</dd>
          </div>
          <div>
            <dt>Estado do canal</dt>
            <dd>{channelStateLabels[lead.channel_state]}</dd>
          </div>
          <div>
            <dt>Canal responsável</dt>
            <dd>{labelFor(channelOwnerLabels, lead.channel_owner)}</dd>
          </div>
          <div>
            <dt>Score</dt>
            <dd>{formatInteger(lead.score)}</dd>
          </div>
          <div>
            <dt>Papel</dt>
            <dd>{lead.role ?? "—"}</dd>
          </div>
          <div>
            <dt>Nicho</dt>
            <dd>{lead.niche ?? "—"}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{lead.source ?? "—"}</dd>
          </div>
          <div>
            <dt>Próxima ação</dt>
            <dd>
              {lead.next_action ?? "—"}
              {lead.next_action_at ? (
                <>
                  <br />
                  <span className="muted">{formatDateTime(lead.next_action_at, timeZone)}</span>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Cadastrado em</dt>
            <dd>{formatDateTime(lead.created_at, timeZone)}</dd>
          </div>
          <div>
            <dt>Atualizado em</dt>
            <dd>{formatDateTime(lead.updated_at, timeZone)}</dd>
          </div>
        </dl>

        {tags.length > 0 ? (
          <div className="kanban-card-meta" style={{ marginTop: "1rem" }}>
            {tags.map((tag) => (
              <span className="badge badge-neutral" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="kanban-card-meta" style={{ marginTop: "1rem" }}>
          <a className="badge" href={instagramUrl} target="_blank" rel="noreferrer">
            Abrir no Instagram
          </a>
          <OptionalLink
            className="badge"
            href={business.whatsappLink}
            missingLabel="WhatsApp não configurado"
          >
            WhatsApp comercial
          </OptionalLink>
          <OptionalLink
            className="badge"
            href={affiliateGroupLink}
            missingLabel="Grupo de afiliados não configurado"
          >
            Grupo de afiliados
          </OptionalLink>
        </div>
      </section>

      {conversation ? (
        <>
          <h2>Conversa</h2>
          <section className="card">
            <dl className="definitions">
              <div>
                <dt>Responsável</dt>
                <dd>{labelFor(channelOwnerLabels, conversation.owner)}</dd>
              </div>
              <div>
                <dt>Última mensagem recebida</dt>
                <dd>{formatDateTime(conversation.lastInboundAt, timeZone)}</dd>
              </div>
              <div>
                <dt>Janela da API expira em</dt>
                <dd>{formatDateTime(conversation.apiWindowExpiresAt, timeZone)}</dd>
              </div>
            </dl>
          </section>
        </>
      ) : null}

      {profile ? (
        <>
          <h2>Perfil público observado</h2>
          <section className="card">
            <dl className="definitions">
              <div>
                <dt>Categoria</dt>
                <dd>{profile.category || "—"}</dd>
              </div>
              <div>
                <dt>Localização</dt>
                <dd>{profile.location || "—"}</dd>
              </div>
              <div>
                <dt>Seguidores</dt>
                <dd>{profile.followerCount ? formatInteger(profile.followerCount) : "—"}</dd>
              </div>
            </dl>
            {profile.bio ? <p style={{ marginBottom: 0 }}>{profile.bio}</p> : null}
          </section>
        </>
      ) : null}

      <h2>Histórico</h2>
      {timeline.length === 0 ? (
        <p className="empty">Nenhum registro para este lead ainda.</p>
      ) : (
        <ul className="timeline">
          {timeline.map((entry, index) => (
            <li className="timeline-item" data-kind={entry.kind} key={`${entry.at}-${index}`}>
              <div className="timeline-head">
                <strong>{entry.title}</strong>
                <time dateTime={entry.at}>{formatDateTime(entry.at, timeZone)}</time>
              </div>
              <p className={entry.kind === "event" ? "mono" : undefined}>{entry.detail}</p>
              {entry.meta ? <p className="muted">{entry.meta}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function parseProfile(raw: string): PublicProfileObservation | null {
  try {
    return JSON.parse(raw) as PublicProfileObservation;
  } catch {
    return null;
  }
}
