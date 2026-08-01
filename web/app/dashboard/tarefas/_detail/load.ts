import { getMe } from "@/lib/api/me";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { getOpportunity } from "@/lib/api/opportunities";
import { getTask } from "@/lib/api/tasks";
import { listAttachments } from "@/lib/api/task-attachments";
import { listMemberships } from "@/lib/api/memberships";

// Carregamento compartilhado entre a versão full-page do detalhe de
// tarefa (tarefas/[id]/page.tsx, fallback de acesso direto) e a versão
// modal interceptada (@modal/(.)tarefas/[id]/page.tsx).
export async function loadTaskDetail(token: string, id: string) {
  const [me, task, attachments, memberships] = await Promise.all([
    getMe(token),
    getTask(token, id),
    listAttachments(token, id),
    listMemberships(token),
  ]);

  let targetLabel = "—";
  if (task.companyId) {
    const company = await getCompany(token, task.companyId);
    targetLabel = `Empresa: ${companyDisplayName(company)}`;
  } else if (task.opportunityId) {
    const opp = await getOpportunity(token, task.opportunityId);
    const company = await getCompany(token, opp.companyId);
    targetLabel = `Oportunidade: ${companyDisplayName(company)}`;
  }

  return { me, task, attachments, memberships, targetLabel };
}

export type TaskDetail = Awaited<ReturnType<typeof loadTaskDetail>>;
