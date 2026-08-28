import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getServerContext } from "@/lib/server-context";

import { OptionalLink } from "./_components/optional-link.tsx";

import "./globals.css";

export const metadata: Metadata = {
  title: "Central de Prospecção",
  description: "Operação local e auditável de prospecção no Instagram",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { business } = getServerContext();
  const affiliateGroupLink = business.affiliateGroupLink;
  const instagramUrl = `https://instagram.com/${business.instagramHandle.replace(/^@/, "")}`;

  return (
    <html lang="pt-BR">
      <body>
        <div className="app">
          <aside className="sidebar">
            <Link className="brand" href="/">
              <strong>Central de Prospecção</strong>
              <span>{business.companyName}</span>
            </Link>

            <nav className="nav" aria-label="Navegação principal">
              <Link href="/">Visão geral</Link>

              <p className="nav-group-title">Funis</p>
              <Link href="/funis/clientes">Clientes</Link>
              <Link href="/funis/afiliados">Afiliados</Link>

              <p className="nav-group-title">Operação</p>
              <Link href="/operacao">Fila e exceções</Link>
              <Link href="/experimentos">Experimentos</Link>
              <Link href="/configuracao">Configuração</Link>
            </nav>

            <div className="sidebar-footer">
              <a href={instagramUrl} target="_blank" rel="noreferrer">
                Instagram {business.instagramHandle}
              </a>
              <OptionalLink href={business.whatsappLink} missingLabel="WhatsApp não configurado">
                WhatsApp comercial
              </OptionalLink>
              <OptionalLink href={affiliateGroupLink} missingLabel="Grupo de afiliados não configurado">
                Grupo de afiliados
              </OptionalLink>
            </div>
          </aside>

          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
