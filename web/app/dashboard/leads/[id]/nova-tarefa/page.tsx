import { redirect } from "next/navigation";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { resolveAssigneeOptions } from "@/lib/api/assignee-options";
import { loadLeadFicha } from "../../_ficha/load";
import NovaForm from "../../../tarefas/nova/nova-form";

// Fallback full-page de "Criar tarefa" a partir da ficha de um lead/
// empresa na Prospecção (pedido do usuário, 2026-08-04 — substituiu o
// quick-add "Nova tarefa para esta empresa" + Prazo que ficava direto na
// aba Tarefas da ficha). Em navegação normal dentro do app, essa mesma
// rota é interceptada e abre como modal, empilhado sobre o drawer da
// ficha (os dois slots — @drawer e @modal — renderizam juntos, ver
// dashboard/layout.tsx) — ver @modal/(.)leads/[id]/nova-tarefa.
export default async function NovaTarefaDoLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const ficha = await loadLeadFicha(token, id);
  if (!ficha.companyId) {
    redirect(`/dashboard/leads/${id}`);
  }
  const [company, assigneeOptions] = await Promise.all([
    getCompany(token, ficha.companyId),
    resolveAssigneeOptions(token),
  ]);
  const lockedLabel = `Empresa: ${companyDisplayName(company)}`;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Gerar tarefa</div>
        </div>
      </div>
      <div className="content">
        <div className="form-panel">
          <NovaForm
            lockedCompanyId={ficha.companyId}
            lockedLabel={lockedLabel}
            initialContacts={ficha.contacts}
            assigneeOptions={assigneeOptions}
          />
        </div>
      </div>
    </>
  );
}
