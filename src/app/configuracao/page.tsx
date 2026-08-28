import { formatInteger, formatUsd, integrationModeLabels } from "@/lib/labels";
import { getServerContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

export default function ConfigurationPage() {
  const { env, business } = getServerContext();

  return (
    <>
      <header className="page-header">
        <h1>Configuração</h1>
        <p>
          Somente leitura. Os valores vêm de <span className="mono">config/business.json</span> e do arquivo{" "}
          <span className="mono">.env</span>, que ficam fora do controle de versão. Nenhuma credencial é exibida
          aqui.
        </p>
      </header>

      <h2>Identidade</h2>
      <section className="card">
        <dl className="definitions">
          <div>
            <dt>Responsável</dt>
            <dd>
              {business.ownerName} — {business.ownerRole}
            </dd>
          </div>
          <div>
            <dt>Empresa</dt>
            <dd>{business.companyName}</dd>
          </div>
          <div>
            <dt>Site</dt>
            <dd>
              <a href={business.companyWebsite} target="_blank" rel="noreferrer">
                {business.companyWebsite}
              </a>
            </dd>
          </div>
          <div>
            <dt>Instagram</dt>
            <dd>{business.instagramHandle}</dd>
          </div>
          <div>
            <dt>WhatsApp</dt>
            <dd>{business.whatsappLink ?? "não configurado"}</dd>
          </div>
          <div>
            <dt>Grupo de afiliados</dt>
            <dd>{business.affiliateGroupLink ?? "não configurado"}</dd>
          </div>
          <div>
            <dt>Geografia</dt>
            <dd>{business.geography}</dd>
          </div>
        </dl>
      </section>

      <h2>Afirmações permitidas</h2>
      <div className="banner" data-tone="success">
        <div>
          <strong>A IA só pode enviar estas afirmações</strong>
          <p>Paráfrase não é permitida. Qualquer outra alegação é bloqueada antes do envio.</p>
        </div>
      </div>
      <section className="card">
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {business.verifiedClaims.map((claim) => (
            <li key={claim}>{claim}</li>
          ))}
        </ul>
      </section>

      <h2>Afirmações bloqueadas</h2>
      <div className="banner" data-tone="danger">
        <div>
          <strong>Nunca podem ser enviadas</strong>
          <p>Permanecem bloqueadas até serem comprovadas em material oficial da empresa.</p>
        </div>
      </div>
      <section className="card">
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {business.unverifiedClaims.map((claim) => (
            <li key={claim}>{claim}</li>
          ))}
        </ul>
      </section>

      <h2>Público-alvo</h2>
      <section className="card">
        <dl className="definitions">
          <div>
            <dt>Segmentos</dt>
            <dd>{business.icpSegments.join(" · ")}</dd>
          </div>
          <div>
            <dt>Palavras-chave</dt>
            <dd>{business.icpKeywords.join(" · ")}</dd>
          </div>
          <div>
            <dt>Temas de afiliados</dt>
            <dd>{business.affiliateTopics.join(" · ")}</dd>
          </div>
        </dl>
      </section>

      <h2>Limites operacionais</h2>
      <section className="card">
        <dl className="definitions">
          <div>
            <dt>DMs por dia</dt>
            <dd>{formatInteger(env.maxDmsPerDay)}</dd>
          </div>
          <div>
            <dt>Intervalo entre DMs</dt>
            <dd>
              {formatInteger(env.minSecondsBetweenDms)}s a {formatInteger(env.maxSecondsBetweenDms)}s
            </dd>
          </div>
          <div>
            <dt>Janela de operação</dt>
            <dd>
              {env.operatingHours} ({env.operatingTimezone})
            </dd>
          </div>
          <div>
            <dt>Teto mensal de IA</dt>
            <dd>{formatUsd(env.openAiMonthlyBudgetUsd)}</dd>
          </div>
          <div>
            <dt>Modelo de redação</dt>
            <dd className="mono">{env.openAiModel ?? "não configurado"}</dd>
          </div>
          <div>
            <dt>Modelo de classificação</dt>
            <dd className="mono">{env.openAiModelFast ?? "não configurado"}</dd>
          </div>
        </dl>
      </section>

      <h2>Integrações</h2>
      <section className="card">
        <dl className="definitions">
          <div>
            <dt>Navegador</dt>
            <dd>
              {integrationModeLabels[env.browserMode]}
              <br />
              <span className="muted">
                {env.browserLiveAuthorized ? "Envio real autorizado" : "Envio real não autorizado"}
              </span>
            </dd>
          </div>
          <div>
            <dt>API do Instagram</dt>
            <dd>
              {integrationModeLabels[env.instagramMode]}
              <br />
              <span className="muted">
                {env.instagramLiveAuthorized ? "Envio real autorizado" : "Envio real não autorizado"}
              </span>
            </dd>
          </div>
          <div>
            <dt>Chave da OpenAI</dt>
            <dd>{env.openAiApiKey ? "Configurada" : "Não configurada"}</dd>
          </div>
          <div>
            <dt>Credenciais da Meta</dt>
            <dd>{env.instagramPageAccessToken ? "Configuradas" : "Não configuradas"}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
