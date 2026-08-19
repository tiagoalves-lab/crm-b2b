import Link from "next/link";

export type Aba = "timeline" | "tarefas" | "dados" | "contatos";

export const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "dados", label: "Dados cadastrais" },
  { id: "contatos", label: "Contatos" },
  { id: "tarefas", label: "Tarefas" },
];

export function currentAbaOf(aba?: string): Aba {
  return ABAS.find((a) => a.id === aba)?.id ?? "timeline";
}

export default function FichaTabs({
  leadId,
  aba,
  counts,
}: {
  leadId: string;
  aba?: string;
  counts: { timeline: number; tarefas: number; contatos: number };
}) {
  const current = currentAbaOf(aba);
  const href = (a: Aba) => `/dashboard/leads/${leadId}?aba=${a}`;
  // `replace` em vez de push — ver mesmo comentário em empresas/_ficha/
  // ficha-tabs.tsx: sem isso o X do drawer só desfaz uma aba por clique.

  return (
    <>
      {ABAS.map((a) => {
        const count =
          a.id === "timeline"
            ? counts.timeline
            : a.id === "tarefas"
              ? counts.tarefas
              : a.id === "contatos"
                ? counts.contatos
                : undefined;
        return (
          <Link key={a.id} href={href(a.id)} replace className={current === a.id ? "drawer-tab active" : "drawer-tab"}>
            {a.label}
            {count !== undefined && <span className="tab-count">{count}</span>}
          </Link>
        );
      })}
    </>
  );
}
