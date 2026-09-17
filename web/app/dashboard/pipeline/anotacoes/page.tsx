import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import AnotacoesLista from "../_anotacoes/anotacoes-lista";
import { loadAnotacoes } from "../_anotacoes/load";

// Página cheia do histórico de anotações (2026-09-09) — fallback de
// acesso direto pela URL/refresh; a navegação normal, pelo ícone da barra
// da tela Pipeline, abre a versão modal
// (@modal/(.)pipeline/anotacoes/page.tsx). Mesmo par página/modal do card
// de oportunidade.
export default async function AnotacoesPage() {
  const token = await getServerAccessToken();
  const { items, memberships } = await loadAnotacoes(token);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Histórico de anotações</div>
          <div className="page-sub">
            Comentários registrados nos cards do Pipeline · fixados no topo
          </div>
        </div>
        <Link href="/dashboard/pipeline" className="btn btn-ghost">
          Voltar
        </Link>
      </div>

      <div className="content">
        <AnotacoesLista items={items} memberships={memberships} />
      </div>
    </>
  );
}
