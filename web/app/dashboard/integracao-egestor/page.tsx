import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listEgestorContatos } from "@/lib/api/egestor";
import type { EgestorContatoStatus } from "@/lib/api/types";
import { formatDateTimeBR } from "@/lib/format-date";
import ConfirmSubmitButton from "../membros/confirm-submit-button";
import EgestorTable from "./egestor-table";
import { promoteEgestorAction, syncEgestorAction, syncEgestorVendasAction } from "./actions";

// Relatório de auditoria + correção Matriz×Filial (docs/roadmap.md, itens
// 9.3/9.6/9.9) — menu "Integração eGestor" em Administração, só
// owner/admin (nav já esconde o item pros demais papéis, ver
// dashboard-nav.tsx; guard aqui é defesa em profundidade, mesmo padrão de
// membros/novo). Tabela (checkbox + seleção em lote + busca) vive em
// egestor-table.tsx — único trecho client-side desta tela, mesmo desenho
// de Empresas: o filtro de status continua por querystring (recorta as
// linhas aqui no servidor), mas os links dele são renderizados lá dentro
// pra dividir a mesma barra com a busca, que é estado local.
export default async function IntegracaoEgestorPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; msg?: string }>;
}) {
  const { status, error } = await searchParams;
  const token = await getServerAccessToken();
  const me = await getMe(token);
  const canManage = me.membership.role === "owner" || me.membership.role === "admin";

  if (!canManage) {
    return (
      <div className="content">
        <div className="error-banner">
          Só owner/admin podem ver a Integração eGestor.
        </div>
      </div>
    );
  }

  const rows = await listEgestorContatos(token);

  const counts = {
    todas: rows.length,
    so_matriz: rows.filter((r) => r.status === "so_matriz").length,
    so_filial: rows.filter((r) => r.status === "so_filial").length,
    ambos_iguais: rows.filter((r) => r.status === "ambos_iguais").length,
    ambos_diferentes: rows.filter((r) => r.status === "ambos_diferentes").length,
  };

  const filtroAtual = (status as EgestorContatoStatus | undefined) ?? undefined;
  const visiveis = filtroAtual ? rows.filter((r) => r.status === filtroAtual) : rows;

  const ultimaSincronizacao = rows.reduce<string | null>((max, r) => {
    if (!max || r.lastSyncedAt > max) return r.lastSyncedAt;
    return max;
  }, null);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Integração eGestor</div>
          <div className="page-sub">
            {counts.todas} contato(s) consolidado(s) Matriz + Filial
            {ultimaSincronizacao
              ? ` — última sincronização em ${formatDateTimeBR(ultimaSincronizacao)}`
              : " — nunca sincronizado"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/dashboard/integracao-egestor/historico" className="btn btn-ghost">
            Histórico de requisições
          </Link>
          <form>
            <ConfirmSubmitButton
              className="btn btn-ghost"
              confirmMessage="Promover todos os contatos limpos (sem divergência ou só num lado) pra Company de verdade?"
              formAction={promoteEgestorAction}
              pendingLabel="Promovendo…"
            >
              Promover contatos limpos
            </ConfirmSubmitButton>
          </form>
          <form>
            <ConfirmSubmitButton
              className="btn btn-ghost"
              confirmMessage="Trazer o histórico de vendas das duas contas do eGestor (Matriz e Filial)? Só entram vendas de clientes que já existem no CRM."
              formAction={syncEgestorVendasAction}
              pendingLabel="Trazendo vendas…"
            >
              Sincronizar vendas
            </ConfirmSubmitButton>
          </form>
          <form>
            <ConfirmSubmitButton
              className="btn btn-primary"
              confirmMessage="Sincronizar agora com as duas contas do eGestor (Matriz e Filial)? Pode levar alguns minutos."
              formAction={syncEgestorAction}
              pendingLabel="Sincronizando…"
            >
              Sincronizar agora
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}

        <div className="stat-grid">
          <div className="stat-tile blue">
            <div className="stat-label">Só Matriz</div>
            <div className="stat-value">{counts.so_matriz}</div>
          </div>
          <div className="stat-tile purple">
            <div className="stat-label">Só Filial</div>
            <div className="stat-value">{counts.so_filial}</div>
          </div>
          <div className="stat-tile green">
            <div className="stat-label">Iguais</div>
            <div className="stat-value">{counts.ambos_iguais}</div>
          </div>
          <div className="stat-tile danger">
            <div className="stat-label">Divergentes</div>
            <div className="stat-value">{counts.ambos_diferentes}</div>
          </div>
        </div>

        <EgestorTable rows={visiveis} counts={counts} filtroAtual={filtroAtual} />
      </div>
    </>
  );
}
