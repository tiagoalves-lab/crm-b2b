import { getMe } from "@/lib/api/me";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
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
  let companyId: string | null = null;
  if (task.companyId) {
    companyId = task.companyId;
    const company = await getCompany(token, companyId);
    targetLabel = `Empresa: ${companyDisplayName(company)}`;
  } else if (task.opportunityId) {
    const opp = await getOpportunity(token, task.opportunityId);
    companyId = opp.companyId;
    const company = await getCompany(token, companyId);
    targetLabel = `Oportunidade: ${companyDisplayName(company)}`;
  }

  // Empresa é fixa nesse ponto (vínculo imutável após a criação da
  // tarefa) — contatos pra Ligação/Reunião/Visita/E-mail (pedido do usuário,
  // 2026-08-04) resolvidos aqui, sem precisar de fetch disparado no
  // cliente (diferente de "Nova tarefa", onde a empresa ainda pode
  // mudar).
  const contacts = companyId ? await listContacts(token, companyId) : [];

  return { me, task, attachments, memberships, targetLabel, contacts, companyId };
}

export type TaskDetail = Awaited<ReturnType<typeof loadTaskDetail>>;
