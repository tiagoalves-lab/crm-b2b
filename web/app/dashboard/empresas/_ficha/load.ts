import { getMe } from "@/lib/api/me";
import { getCompany } from "@/lib/api/companies";
import { listActivities } from "@/lib/api/activities";
import { listTasks } from "@/lib/api/tasks";
import { listOpportunities } from "@/lib/api/opportunities";
import { listSalesHistory, listSalesHistoryItems } from "@/lib/api/sales-history";
import { listContacts } from "@/lib/api/contacts";

// Carregamento compartilhado entre a versão full-page da ficha
// (empresas/[id]/page.tsx, fallback de acesso direto/refresh) e a versão
// drawer interceptada (@drawer/(.)empresas/[id]/page.tsx) — ambas
// precisam dos mesmos dados, só a moldura em volta muda.
export async function loadFicha(token: string, companyId: string) {
  const [
    me,
    company,
    { items: activities },
    { items: tasks },
    { items: opportunities },
    salesHistory,
    salesItems,
    contacts,
  ] = await Promise.all([
    getMe(token),
    getCompany(token, companyId),
    listActivities(token, { companyId }),
    listTasks(token, { companyId }),
    listOpportunities(token, { companyId }),
    listSalesHistory(token, { companyId }),
    // Itens de produto/serviço exigem `empresas_vendas`, que nasce
    // desligado pro representante — quem não tem a permissão recebe 403
    // aqui. Degrada pra lista vazia em vez de derrubar a ficha inteira:
    // as abas que dependem disso já não são nem renderizadas pra ele
    // (ver FichaTabs), e as outras seis não têm por que quebrar junto.
    listSalesHistoryItems(token, { companyId }).catch(() => []),
    listContacts(token, companyId),
  ]);

  return { me, company, activities, tasks, opportunities, salesHistory, salesItems, contacts };
}

export type FichaData = Awaited<ReturnType<typeof loadFicha>>;

// Números que aparecem como bolinha ao lado do nome de cada aba. Aqui em
// vez de em cada página porque as duas molduras da ficha (drawer e
// full-page) mostram exatamente os mesmos contadores.
//
// Produtos/serviços contam itens DISTINTOS, não linhas de venda: a aba
// responde "quantos produtos diferentes esta empresa compra".
export function contagensDaFicha(data: FichaData) {
  const distintos = (tipo: "produto" | "servico") =>
    new Set(
      data.salesItems
        .filter((i) => i.tipo === tipo)
        .map((i) => i.codProduto ?? `d:${i.descricao}`),
    ).size;

  return {
    timeline: data.activities.length,
    tarefas: data.tasks.length,
    negocios: data.opportunities.length,
    contatos: data.contacts.length,
    vendas: data.salesHistory.length,
    produtos: distintos("produto"),
    servicos: distintos("servico"),
  };
}
