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
  let prefixo = "Empresa";
  // Itens da oportunidade de origem (2026-09-04) — opções de carimbo na
  // ficha; vazio em tarefa vinculada só a empresa.
  let opportunityItems: string[] = [];
  if (task.companyId) {
    companyId = task.companyId;
  } else if (task.opportunityId) {
    const opp = await getOpportunity(token, task.opportunityId);
    companyId = opp.companyId;
    prefixo = "Oportunidade";
    opportunityItems = (opp.items ?? []).map((item) => item.name);
  }

  // Empresa e contatos de uma vez (2026-09-03 — eram duas idas em
  // sequência a cada abertura da ficha).
  const [company, contacts] = companyId
    ? await Promise.all([getCompany(token, companyId), listContacts(token, companyId)])
    : [null, []];
  if (company) targetLabel = `${prefixo}: ${companyDisplayName(company)}`;

  return { me, task, attachments, memberships, targetLabel, contacts, companyId, opportunityItems };
}

export type TaskDetail = Awaited<ReturnType<typeof loadTaskDetail>>;
