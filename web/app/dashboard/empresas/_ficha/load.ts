import { getMe } from "@/lib/api/me";
import { getCompany } from "@/lib/api/companies";
import { listActivities } from "@/lib/api/activities";
import { listTasks } from "@/lib/api/tasks";
import { listOpportunities } from "@/lib/api/opportunities";
import { listSalesHistory, listSalesHistoryItems } from "@/lib/api/sales-history";
import { listContacts } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/client";

// 403 = "sem permissão pra esta aba" (ver comentário no Promise.all de
// loadFicha). Só esse status vira vazio; qualquer outro erro sobe como
// antes.
async function vazioSe403<T, V>(promise: Promise<T>, vazio: V): Promise<T | V> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return vazio;
    throw error;
  }
}

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
    // Cada aba tem permissão própria ("ver" de empresas_timeline/
    // empresas_tarefas/empresas_oportunidades/contatos/empresas_vendas) —
    // quem não tem recebe 403 na lista daquela aba. Degrada pra vazio em
    // vez de derrubar a ficha inteira: a empresa em si (getCompany acima)
    // continua obrigatória, e as outras abas não têm por que quebrar
    // junto. `empresas_vendas` é o caso comum (nasce desligado pro
    // representante, e as abas dele nem são renderizadas — ver
    // FichaTabs); os outros valem pra quem teve a aba desligada membro a
    // membro na tela de Permissões.
    vazioSe403(listActivities(token, { companyId }), { items: [] }),
    vazioSe403(listTasks(token, { companyId }), { items: [] }),
    vazioSe403(listOpportunities(token, { companyId }), { items: [] }),
    vazioSe403(listSalesHistory(token, { companyId }), []),
    vazioSe403(listSalesHistoryItems(token, { companyId }), []),
    vazioSe403(listContacts(token, companyId), []),
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
