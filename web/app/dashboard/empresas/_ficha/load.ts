import { getMe } from "@/lib/api/me";
import { getCompany } from "@/lib/api/companies";
import { listActivities } from "@/lib/api/activities";
import { listTasks } from "@/lib/api/tasks";
import { listOpportunities } from "@/lib/api/opportunities";
import { listSalesHistory } from "@/lib/api/sales-history";
import { listContacts } from "@/lib/api/contacts";

// Carregamento compartilhado entre a versão full-page da ficha
// (empresas/[id]/page.tsx, fallback de acesso direto/refresh) e a versão
// drawer interceptada (@drawer/(.)empresas/[id]/page.tsx) — ambas
// precisam dos mesmos dados, só a moldura em volta muda.
export async function loadFicha(token: string, companyId: string) {
  const [me, company, { items: activities }, { items: tasks }, { items: opportunities }, salesHistory, contacts] =
    await Promise.all([
      getMe(token),
      getCompany(token, companyId),
      listActivities(token, { companyId }),
      listTasks(token, { companyId }),
      listOpportunities(token, { companyId }),
      listSalesHistory(token, { companyId }),
      listContacts(token, companyId),
    ]);

  return { me, company, activities, tasks, opportunities, salesHistory, contacts };
}

export type FichaData = Awaited<ReturnType<typeof loadFicha>>;
