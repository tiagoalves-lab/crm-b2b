"use client";

import { useRouter } from "next/navigation";

export interface ActivityRow {
  id: string;
  kind: string;
  userLabel: string;
  text: string;
  company: string | null;
  when: string;
  href: string;
}

// "Últimas atividades" (Painel comercial) — linha inteira clicável, leva
// pro registro de origem (empresa, oportunidade ou tarefa — ver
// describeActivity() em page.tsx pra como o href é resolvido pra cada
// tipo de evento).
export default function RecentActivityTable({ rows }: { rows: ActivityRow[] }) {
  const router = useRouter();

  return (
    <table className="mini-table">
      <thead>
        <tr>
          <th style={{ width: 100 }}>Tipo</th>
          <th style={{ width: 110 }}>Responsável</th>
          <th>Atividade</th>
          <th style={{ width: 160 }}>Empresa</th>
          <th style={{ width: 60, textAlign: "right" }}>Data</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="row-clickable" onClick={() => router.push(row.href)}>
            <td style={{ width: 100, whiteSpace: "nowrap" }}>
              <span className="task-type">{row.kind}</span>
            </td>
            <td style={{ width: 110, whiteSpace: "nowrap", fontSize: 12 }}>{row.userLabel}</td>
            <td className="t-co">{row.text}</td>
            <td className="t-sub" style={{ width: 160 }}>
              {row.company ?? "—"}
            </td>
            <td
              style={{
                width: 60,
                textAlign: "right",
                fontSize: 11,
                color: "var(--text-tertiary)",
                whiteSpace: "nowrap",
              }}
            >
              {row.when}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td className="empty">Nenhuma atividade recente.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
