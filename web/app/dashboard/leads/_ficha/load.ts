import { getMe } from "@/lib/api/me";
import { getRawLead } from "@/lib/api/raw-leads";
import { listActivities } from "@/lib/api/activities";
import { listTasks } from "@/lib/api/tasks";
import { listContacts } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/client";

// Carregamento compartilhado entre a versão full-page da ficha do lead
// (leads/[id]/page.tsx, fallback de acesso direto) e a versão drawer
// interceptada (@drawer/(.)leads/[id]/page.tsx).
export async function loadLeadFicha(token: string, leadId: string) {
  const [me, lead] = await Promise.all([getMe(token), getRawLead(token, leadId)]);

  const companyId = lead.promotedCompanyId;
  let activities: Awaited<ReturnType<typeof listActivities>>["items"] = [];
  let tasks: Awaited<ReturnType<typeof listTasks>>["items"] = [];
  let contacts: Awaited<ReturnType<typeof listContacts>> = [];
  let accessRestricted = false;

  if (companyId) {
    try {
      const [act, tsk, cts] = await Promise.all([
        listActivities(token, { companyId }),
        listTasks(token, { companyId }),
        listContacts(token, companyId),
      ]);
      activities = act.items;
      tasks = tsk.items;
      contacts = cts;
    } catch (error) {
      // A empresa por trás do lead ainda não tem responsável atribuído —
      // manager/sales_rep não enxergam histórico/tarefas/contatos dela
      // (regra de PolicyService), diferente do raw_lead em si, que é
      // "área comum". Não deixa a ficha inteira quebrar (era um 404 não
      // tratado que derrubava o Server Component inteiro) — degrada pras
      // abas mostrarem um aviso em vez de estourar exceção.
      if (error instanceof ApiError && error.status === 404) {
        accessRestricted = true;
      } else {
        throw error;
      }
    }
  }

  return { me, lead, companyId, activities, tasks, contacts, accessRestricted };
}

export type LeadFicha = Awaited<ReturnType<typeof loadLeadFicha>>;
