import { getMe } from "@/lib/api/me";
import { getRawLead } from "@/lib/api/raw-leads";
import { listActivities } from "@/lib/api/activities";
import { listTasks } from "@/lib/api/tasks";

// Carregamento compartilhado entre a versão full-page da ficha do lead
// (leads/[id]/page.tsx, fallback de acesso direto) e a versão drawer
// interceptada (@drawer/(.)leads/[id]/page.tsx).
export async function loadLeadFicha(token: string, leadId: string) {
  const [me, lead] = await Promise.all([getMe(token), getRawLead(token, leadId)]);

  const companyId = lead.promotedCompanyId;
  const [{ items: activities }, { items: tasks }] = companyId
    ? await Promise.all([listActivities(token, { companyId }), listTasks(token, { companyId })])
    : [{ items: [] }, { items: [] }];

  return { me, lead, companyId, activities, tasks };
}

export type LeadFicha = Awaited<ReturnType<typeof loadLeadFicha>>;
