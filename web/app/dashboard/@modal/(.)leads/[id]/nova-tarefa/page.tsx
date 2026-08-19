import { redirect } from "next/navigation";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { resolveAssigneeOptions } from "@/lib/api/assignee-options";
import { loadLeadFicha } from "@/app/dashboard/leads/_ficha/load";
import NovaForm from "@/app/dashboard/tarefas/nova/nova-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

// "Criar tarefa" a partir da ficha de um lead/empresa na Prospecção
// (feature nova, pedido do usuário 2026-08-04) — reusa o mesmo NovaForm
// de Tarefas, com o vínculo travado na empresa de origem (ver prop
// lockedCompanyId). Abre empilhado sobre o drawer da ficha (@drawer e
// @modal são slots independentes, os dois renderizam juntos).
export default async function NovaTarefaDoLeadModal({
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
    <OverlayModal title="Gerar tarefa" wide>
      <NovaForm
        lockedCompanyId={ficha.companyId}
        lockedLabel={lockedLabel}
        initialContacts={ficha.contacts}
        assigneeOptions={assigneeOptions}
      />
    </OverlayModal>
  );
}
