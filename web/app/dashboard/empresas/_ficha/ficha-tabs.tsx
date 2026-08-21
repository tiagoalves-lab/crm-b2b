import Link from "next/link";

export type Aba =
  | "overview"
  | "cadastro"
  | "contatos"
  | "timeline"
  | "tarefas"
  | "negocios"
  | "vendas"
  | "posvenda"
  | "abc"
  | "servicos";

// Ordem pedida pelo usuário (2026-08-21): Vendas entre Oportunidades e
// Pós-venda; ABC de Produtos e Serviços depois de Pós-venda. As três novas
// saem do mesmo dado (o que a empresa comprou) e são controladas pela
// mesma permissão, `empresas_vendas`.
export const ABAS: Array<{ id: Aba; label: string; permissao?: "empresas_vendas" }> = [
  { id: "overview", label: "Visão geral" },
  { id: "cadastro", label: "Dados cadastrais" },
  { id: "contatos", label: "Contatos" },
  { id: "timeline", label: "Timeline" },
  { id: "tarefas", label: "Tarefas" },
  { id: "negocios", label: "Oportunidades" },
  { id: "vendas", label: "Vendas", permissao: "empresas_vendas" },
  { id: "posvenda", label: "Pós-venda" },
  { id: "abc", label: "ABC de Produtos", permissao: "empresas_vendas" },
  { id: "servicos", label: "Serviços", permissao: "empresas_vendas" },
];

export function currentAbaOf(aba?: string): Aba {
  return ABAS.find((a) => a.id === aba)?.id ?? "overview";
}

// Reaproveita .drawer-tab/.tab-count tanto na versão drawer quanto na
// versão full-page (fallback de acesso direto) — mesma aparência do
// protótipo nos dois casos, só a moldura em volta (drawer vs topbar) muda.
export default function FichaTabs({
  companyId,
  aba,
  counts,
  podeVerVendas,
}: {
  companyId: string;
  aba?: string;
  counts: {
    timeline: number;
    tarefas: number;
    negocios: number;
    contatos: number;
    vendas: number;
    produtos: number;
    servicos: number;
  };
  // Quem não tem a permissão nem vê as três abas de faturamento. O
  // bloqueio de verdade é no backend (SalesHistoryService) — isto aqui é
  // pra não oferecer uma aba que responderia 403.
  podeVerVendas: boolean;
}) {
  const current = currentAbaOf(aba);
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
    vendas: counts.vendas,
    abc: counts.produtos,
    servicos: counts.servicos,
  };

  return (
    <>
      {ABAS.filter((a) => !a.permissao || podeVerVendas).map((a) => {
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
