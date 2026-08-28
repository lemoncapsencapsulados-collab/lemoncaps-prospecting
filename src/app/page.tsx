export default function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">OPERAÇÃO LOCAL</p>
      <h1>Central de Prospecção</h1>
      <p className="subtitle">
        O painel está sendo preparado. As integrações externas permanecem em modo simulado.
      </p>
      <section className="status-card" aria-label="Estado inicial do sistema">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>Ambiente protegido</strong>
          <p>Nenhum envio real é realizado sem configuração e autorização explícitas.</p>
        </div>
      </section>
    </main>
  );
}
