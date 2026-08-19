import Link from "next/link";

export type Aba = "overview" | "cadastro" | "contatos" | "timeline" | "tarefas" | "negocios" | "posvenda";

export const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "overview", label: "Visão geral" },
  { id: "cadastro", label: "Dados cadastrais" },
  { id: "contatos", label: "Contatos" },
  { id: "timeline", label: "Timeline" },
  { id: "tarefas", label: "Tarefas" },
  { id: "negocios", label: "Oportunidades" },
  { id: "posvenda", label: "Pós-venda" },
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
}: {
  companyId: string;
  aba?: string;
  counts: { timeline: number; tarefas: number; negocios: number; contatos: number };
}) {
  const current = currentAbaOf(aba);
  const href = (a: Aba) => `/dashboard/empresas/${companyId}?aba=${a}`;
  // `replace` em vez de push: sem isso, cada troca de aba empilha uma
  // entrada de histórico e o X do drawer (router.back() em
  // overlay-drawer.tsx) só desfaz uma aba por clique em vez de fechar de
  // vez, não importa em qual aba o usuário estava.

  return (
    <>
      {ABAS.map((a) => {
        const count =
          a.id === "timeline"
            ? counts.timeline
            : a.id === "tarefas"
              ? counts.tarefas
              : a.id === "negocios"
                ? counts.negocios
                : a.id === "contatos"
                  ? counts.contatos
                  : undefined;
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
