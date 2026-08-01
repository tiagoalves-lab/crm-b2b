import Link from "next/link";

export type Aba = "timeline" | "tarefas" | "dados";

export const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "timeline", label: "Histórico" },
  { id: "tarefas", label: "Tarefas" },
  { id: "dados", label: "Dados do lead" },
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
  counts: { timeline: number; tarefas: number };
}) {
  const current = currentAbaOf(aba);
  const href = (a: Aba) => `/dashboard/leads/${leadId}?aba=${a}`;

  return (
    <>
      {ABAS.map((a) => {
        const count = a.id === "timeline" ? counts.timeline : a.id === "tarefas" ? counts.tarefas : undefined;
        return (
          <Link key={a.id} href={href(a.id)} className={current === a.id ? "drawer-tab active" : "drawer-tab"}>
            {a.label}
            {count !== undefined && <span className="tab-count">{count}</span>}
          </Link>
        );
      })}
    </>
  );
}
