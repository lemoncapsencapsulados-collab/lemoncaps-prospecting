import Link from "next/link";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getServerContext } from "@/lib/server-context";

import { OptionalLink } from "./_components/optional-link.tsx";

import "./globals.css";

/* Self-hosted at build time: no request to Google on load, no layout shift. */
const archivo = Archivo({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Central de Prospecção",
  description: "Operação local e auditável de prospecção no Instagram",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { business } = getServerContext();
  const affiliateGroupLink = business.affiliateGroupLink;
  const instagramUrl = `https://instagram.com/${business.instagramHandle.replace(/^@/, "")}`;

  return (
    <html lang="pt-BR" className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}>
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
