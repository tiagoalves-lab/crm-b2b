import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listEgestorInteractionLog } from "@/lib/api/egestor";
import type { EgestorInteractionOrigin } from "@/lib/api/types";
import { formatDateTimeBR } from "@/lib/format-date";
import TopbarFilter from "@/app/_components/topbar-filter";

const ORIGIN_LABEL: Record<EgestorInteractionOrigin, string> = {
  crm: "CRM",
  egestor_matriz: "eGestor Matriz",
  egestor_filial: "eGestor Filial",
};
const ORIGIN_PILL: Record<EgestorInteractionOrigin, string> = {
  crm: "pill pill-gray",
  egestor_matriz: "pill pill-blue",
  egestor_filial: "pill pill-purple",
};

// Histórico de requisições (docs/roadmap.md, "Criar log das interações de
// requisições de API", 2026-08-13) — botão ao lado de "Promover contatos
// limpos" na tela Integração eGestor. Motivo direto do usuário: falta de
// confiança de que o CRM como "orquestrador" (correção automática via
// webhook, ver docs/webhook-egestor.md) está de fato fazendo o que diz que
// faz — esta tela é a auditoria disso, sem precisar ler log cru de
// servidor. Rota comum (não modal/drawer interceptado, mesmo padrão de
// [id]/corrigir/page.tsx) — navegação de página inteira, com link de
// volta.
export default async function HistoricoIntegracaoEgestorPage() {
  const token = await getServerAccessToken();
  const me = await getMe(token);
  const canManage = me.membership.role === "owner" || me.membership.role === "admin";

  if (!canManage) {
    return (
      <div className="content">
        <div className="error-banner">
          Só owner/admin podem ver o histórico de requisições do eGestor.
        </div>
      </div>
    );
  }

  const linhas = await listEgestorInteractionLog(token);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Histórico de requisições — Integração eGestor</div>
          <div className="page-sub">
            {linhas.length} interação(ões) registrada(s) — ações manuais da tela e
            processamento automático do webhook (Matriz/Filial)
          </div>
        </div>
        <TopbarFilter />
        <Link href="/dashboard/integracao-egestor" className="btn btn-ghost">
          Voltar
        </Link>
      </div>

      <div className="content">
        {linhas.length === 0 ? (
          <div className="empty-state">Nenhuma interação registrada ainda.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Data/hora</th>
                <th>Origem</th>
                <th>Ações realizadas</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => (
                <tr key={linha.id}>
                  <td className="t-sub" style={{ whiteSpace: "nowrap" }}>
                    {formatDateTimeBR(linha.occurredAt)}
                  </td>
                  <td>
                    <span className={ORIGIN_PILL[linha.origin]}>{ORIGIN_LABEL[linha.origin]}</span>
                  </td>
                  <td>{linha.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
