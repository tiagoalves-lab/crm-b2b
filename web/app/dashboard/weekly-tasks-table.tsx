"use client";

import { useRouter } from "next/navigation";

export interface WeeklyTaskRow {
  id: string;
  tipoLabel: string | null;
  userLabel: string;
  title: string;
  target: string;
  dueLabel: string;
  dueClass: string;
}

// "Ações da semana" (Painel comercial) — linha inteira clicável, abre o
// modal de detalhe da tarefa (mesmo padrão de tarefas/tarefas-table.tsx).
// O botão "Feita" saiu daqui de propósito (pedido do usuário,
// 2026-08-05): concluir/reabrir agora só acontece de dentro do modal.
export default function WeeklyTasksTable({ rows }: { rows: WeeklyTaskRow[] }) {
  const router = useRouter();

  return (
    <table className="mini-table">
      <thead>
        <tr>
          <th style={{ width: 100 }}>Tipo</th>
          <th style={{ width: 110 }}>Responsável</th>
          <th style={{ width: "40%" }}>Tarefa</th>
          <th>Empresa</th>
          <th style={{ width: 90, textAlign: "right" }}>Prazo</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((task) => (
          <tr
            key={task.id}
            className="row-clickable"
            onClick={() => router.push(`/dashboard/tarefas/${task.id}`)}
          >
            <td style={{ width: 100, whiteSpace: "nowrap" }}>
              {task.tipoLabel && <span className="task-type">{task.tipoLabel}</span>}
            </td>
            <td style={{ width: 110, whiteSpace: "nowrap", fontSize: 12 }}>{task.userLabel}</td>
            <td className="t-co" style={{ width: "40%" }}>
              {task.title}
            </td>
            <td className="t-sub">{task.target}</td>
            <td style={{ width: 90, textAlign: "right", whiteSpace: "nowrap" }}>
              <span className={`task-due ${task.dueClass}`}>{task.dueLabel}</span>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td className="empty">Nenhuma ação pendente para esta semana 🎉</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
