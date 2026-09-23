import Link from "next/link";

export type Aba =
  | "overview"
  | "cadastro"
  | "contatos"
  | "timeline"
  | "tarefas"
  | "equipe"
  | "negocios"
  | "vendas"
  | "posvenda"
  | "abc"
  | "servicos";

// Ordem pedida pelo usuário (2026-08-21): Vendas entre Oportunidades e
// Pós-venda; ABC de Produtos e Serviços depois de Pós-venda. As três novas
// saem do mesmo dado (o que a empresa comprou) e são controladas pela
// mesma permissão, `empresas_vendas`.
//
// `somenteCliente` (2026-09-23): Vendas, Pós-venda, ABC e Serviços são da
// CARTEIRA — num cadastro que ainda é lead não têm o que mostrar e só
// poluem a ficha. Equipe de vendas entrou logo depois de Tarefas, mesmo
// lugar da ficha do lead.
export const ABAS: Array<{
  id: Aba;
  label: string;
  permissao?: "empresas_vendas";
  somenteCliente?: boolean;
}> = [
  { id: "overview", label: "Visão geral" },
  { id: "cadastro", label: "Dados cadastrais" },
  { id: "contatos", label: "Contatos" },
  { id: "timeline", label: "Timeline" },
  { id: "tarefas", label: "Tarefas" },
  { id: "equipe", label: "Equipe de vendas" },
  { id: "negocios", label: "Oportunidades" },
  { id: "vendas", label: "Vendas", permissao: "empresas_vendas", somenteCliente: true },
  { id: "posvenda", label: "Pós-venda", somenteCliente: true },
  { id: "abc", label: "ABC de Produtos", permissao: "empresas_vendas", somenteCliente: true },
  { id: "servicos", label: "Serviços", permissao: "empresas_vendas", somenteCliente: true },
];

export interface AbasVisiveisOpts {
  podeVerVendas: boolean;
  isCliente: boolean;
}

export function abasVisiveis(opts: AbasVisiveisOpts) {
  return ABAS.filter(
    (a) => (!a.permissao || opts.podeVerVendas) && (!a.somenteCliente || opts.isCliente),
  );
}

// Sem `opts` = qualquer aba serve (chamadas antigas). Com `opts`, aba
// escondida cai na Visão geral em vez de renderizar conteúdo que a barra
// não oferece — protege o acesso direto por URL (?aba=vendas num lead).
export function currentAbaOf(aba?: string, opts?: AbasVisiveisOpts): Aba {
  const lista = opts ? abasVisiveis(opts) : ABAS;
  return lista.find((a) => a.id === aba)?.id ?? "overview";
}

// Reaproveita .drawer-tab/.tab-count tanto na versão drawer quanto na
// versão full-page (fallback de acesso direto) — mesma aparência do
// protótipo nos dois casos, só a moldura em volta (drawer vs topbar) muda.
export default function FichaTabs({
  companyId,
  aba,
  counts,
  podeVerVendas,
  isCliente,
}: {
  companyId: string;
  aba?: string;
  counts: {
    timeline: number;
    tarefas: number;
    negocios: number;
    contatos: number;
    equipe: number;
    vendas: number;
    produtos: number;
    servicos: number;
  };
  // Quem não tem a permissão nem vê as três abas de faturamento. O
  // bloqueio de verdade é no backend (SalesHistoryService) — isto aqui é
  // pra não oferecer uma aba que responderia 403.
  podeVerVendas: boolean;
  // Cadastro que ainda é lead não mostra as abas da carteira.
  isCliente: boolean;
}) {
  const current = currentAbaOf(aba, { podeVerVendas, isCliente });
  const href = (a: Aba) => `/dashboard/empresas/${companyId}?aba=${a}`;
  // `replace` em vez de push: sem isso, cada troca de aba empilha uma
  // entrada de histórico e o X do drawer (router.back() em
  // overlay-drawer.tsx) só desfaz uma aba por clique em vez de fechar de
  // vez, não importa em qual aba o usuário estava.

  const contagens: Partial<Record<Aba, number>> = {
    timeline: counts.timeline,
    tarefas: counts.tarefas,
    negocios: counts.negocios,
    contatos: counts.contatos,
    equipe: counts.equipe,
    vendas: counts.vendas,
    abc: counts.produtos,
    servicos: counts.servicos,
  };

  return (
    <>
      {abasVisiveis({ podeVerVendas, isCliente }).map((a) => {
        const count = contagens[a.id];
        return (
          <Link
            key={a.id}
            href={href(a.id)}
            replace
            className={current === a.id ? "drawer-tab active" : "drawer-tab"}
          >
            {a.label}
            {count !== undefined && <span className="tab-count">{count}</span>}
          </Link>
        );
      })}
    </>
  );
}
