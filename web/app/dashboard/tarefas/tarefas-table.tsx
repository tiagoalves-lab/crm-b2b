"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeTaskAction, reopenTaskAction } from "./actions";
import { TagChips } from "../pipeline/_detail/item-tags";
import SubmitButton from "@/app/_components/submit-button";

export interface TarefaRow {
  id: string;
  title: string;
  done: boolean;
  // Carimbo de itens da oportunidade de origem (2026-09-04).
  tags: string[];
  tipoLabel: string;
  vinculoLabel: string;
  assigneeLabel: string;
  dueLabel: string;
  dueClass: string;
  nAnexos: number;
  nComentarios: number;
}

// Linha inteira clicável (protótipo: onclick="openTaskDetail(...)" na
// <tr>) — antes só o link em cima do título abria a tarefa. Clique em
// qualquer célula sem elemento interativo próprio (Tipo/Vínculo/Prazo/
// Situação) agora abre a ficha; clique em algo que já tem comportamento
// próprio (checkbox de concluir, link de editar, o próprio link do
// título) segue esse comportamento normal, sem disparar a navegação da
// linha por cima.
export default function TarefasTable({ rows, baseHref }: { rows: TarefaRow[]; baseHref: string }) {
  const router = useRouter();

  function openRow(event: React.MouseEvent<HTMLTableRowElement>, href: string) {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, form")) return;
    router.push(href);
  }

  return (
    <div className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}></th>
            <th>Tarefa</th>
            <th>Responsável</th>
            <th>Tipo</th>
            <th>Vínculo</th>
            <th>Prazo</th>
            <th>Situação</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((task) => {
            const href = `/dashboard/tarefas/${task.id}`;
            return (
              <tr key={task.id} className="row-clickable" onClick={(event) => openRow(event, href)}>
                <td>
                  <form action={task.done ? reopenTaskAction : completeTaskAction}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="back" value={baseHref} />
                    <SubmitButton
                      className={task.done ? "task-check done" : "task-check"}
                      aria-label={task.done ? "Reabrir" : "Concluir"}
                    >
                      {task.done && (
                        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </SubmitButton>
                  </form>
                </td>
                <td>
                  <Link href={href} className={task.done ? "task-title-cell done" : "task-title-cell"}>
                    {task.title}
                  </Link>
                  <TagChips tags={task.tags} />
                  {task.nAnexos > 0 && (
                    <span className="attach-count" title="Anexos">
                      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                      </svg>
                      {task.nAnexos}
                    </span>
                  )}
                  {task.nComentarios > 0 && (
                    <span className="attach-count" title="Comentários">
                      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                      </svg>
                      {task.nComentarios}
                    </span>
                  )}
                </td>
                <td>{task.assigneeLabel}</td>
                <td style={{ fontWeight: 500 }}>{task.tipoLabel}</td>
                <td>
                  <span style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>{task.vinculoLabel}</span>
                </td>
                <td>
                  <span
                    className={`task-due ${task.dueClass}`}
                    style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 500 }}
                  >
                    {task.dueLabel}
                  </span>
                </td>
                <td>
                  <span className={task.done ? "pill pill-green" : "pill pill-gray"}>
                    {task.done ? "Concluída" : "Pendente"}
                  </span>
                </td>
                <td>
                  <div className="cell-actions">
                    <Link href={href} className="icon-btn" title="Editar">
                      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="empty">
                Nenhuma tarefa.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
