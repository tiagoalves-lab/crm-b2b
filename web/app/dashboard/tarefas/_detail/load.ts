import { getMe } from "@/lib/api/me";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
import { getOpportunity } from "@/lib/api/opportunities";
import { getTask } from "@/lib/api/tasks";
import { listAttachments } from "@/lib/api/task-attachments";
import { listMemberships } from "@/lib/api/memberships";
import type { Contact } from "@/lib/api/types";

// Carregamento compartilhado entre a versão full-page do detalhe de
// tarefa (tarefas/[id]/page.tsx, fallback de acesso direto) e a versão
// modal interceptada (@modal/(.)tarefas/[id]/page.tsx).
//
// Membro da tarefa (2026-09-29) pode não enxergar a empresa nem a
// oportunidade por trás dela — nesse caso a ficha abre assim mesmo, com o
// nome da empresa que vem junto da tarefa e sem a agenda de contatos.
export async function loadTaskDetail(token: string, id: string) {
  const [me, task, attachments, memberships] = await Promise.all([
    getMe(token),
    getTask(token, id),
    listAttachments(token, id),
    listMemberships(token),
  ]);

  const refEmpresa = task.company ?? task.opportunity?.company ?? null;
  let targetLabel = refEmpresa ? companyDisplayName(refEmpresa) : "—";
  let companyId: string | null = task.companyId ?? task.opportunity?.companyId ?? null;
  const prefixo = task.companyId ? "Empresa" : "Oportunidade";
  if (refEmpresa) targetLabel = `${prefixo}: ${targetLabel}`;
  // Itens da oportunidade de origem (2026-09-04) — opções de carimbo na
  // ficha; vazio em tarefa vinculada só a empresa.
  let opportunityItems: string[] = [];
  if (!task.companyId && task.opportunityId) {
    const opp = await getOpportunity(token, task.opportunityId).catch(() => null);
    if (opp) {
      companyId = opp.companyId;
      opportunityItems = (opp.items ?? []).map((item) => item.name);
    }
  }

  // Empresa e contatos de uma vez (2026-09-03 — eram duas idas em
  // sequência a cada abertura da ficha).
  const [company, contacts] = companyId
    ? await Promise.all([
        getCompany(token, companyId).catch(() => null),
        listContacts(token, companyId).catch((): Contact[] => []),
      ])
    : [null, [] as Contact[]];
  if (company) targetLabel = `${prefixo}: ${companyDisplayName(company)}`;

  return { me, task, attachments, memberships, targetLabel, contacts, companyId, opportunityItems };
}

export type TaskDetail = Awaited<ReturnType<typeof loadTaskDetail>>;
