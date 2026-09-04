"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useEffect, useState } from "react";
import { dayKeyBR, formatDateOnlyBR } from "@/lib/format-date";
import { moveTaskDueDateAction } from "./actions";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Só dado simples atravessa a fronteira servidor → cliente (rótulos já
// resolvidos em tarefas/page.tsx, mesmo padrão de TarefaRow).
export interface CalendarTask {
  id: string;
  title: string;
  dueAt: string | null;
  done: boolean;
  tipoLabel: string;
  assigneeLabel: string;
  vinculoLabel: string;
}

// dueAt vem de um <input type="date"> (sem hora) — o backend grava como
// meia-noite UTC. Agrupar por toISOString().slice(0,10) evita o dia
// "vazar" pro dia anterior por causa de fuso local (bug clássico de
// calendário com Date local vs. UTC).
function dueDateKey(dueAt: string): string {
  return new Date(dueAt).toISOString().slice(0, 10);
}

function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

// Card arrastável (2026-09-04): o wrapper recebe os listeners do
// @dnd-kit e o Link de dentro continua abrindo a ficha — o PointerSensor
// só ativa o arraste depois de 8px de movimento, então clique é clique.
function TaskCard({ task, overdue }: { task: CalendarTask; overdue: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const className = ["calendar-task", task.done ? "done" : overdue ? "overdue" : "", isDragging ? "dragging" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      className={className}
      title={`${task.title} · ${task.tipoLabel} · ${task.assigneeLabel} · ${task.vinculoLabel}`}
    >
      <Link href={`/dashboard/tarefas/${task.id}`}>
        <div className="calendar-task-title">{task.title}</div>
        <div className="calendar-task-meta">
          <span>{task.tipoLabel}</span>
          <span>{task.assigneeLabel}</span>
          <span>{task.vinculoLabel}</span>
        </div>
      </Link>
    </div>
  );
}

function DayCell({
  dayKey,
  day,
  isToday,
  tasks,
  todayKey,
}: {
  dayKey: string;
  day: number;
  isToday: boolean;
  tasks: CalendarTask[];
  todayKey: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey });
  const className = ["calendar-day", isToday ? "today" : "", isOver ? "drag-over" : ""].filter(Boolean).join(" ");
  return (
    <div ref={setNodeRef} className={className}>
      <div className="calendar-day-number">{day}</div>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} overdue={!task.done && dayKey < todayKey} />
      ))}
    </div>
  );
}

export default function CalendarView({ tasks, month }: { tasks: CalendarTask[]; month?: string }) {
  const [rows, setRows] = useState(tasks);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setRows(tasks), [tasks]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const now = new Date();
  const [yearStr, monthStr] = (month ?? monthKey(now.getUTCFullYear(), now.getUTCMonth())).split("-");
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;

  const firstOfMonth = new Date(Date.UTC(year, monthIndex0, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();
  // "Hoje" no dia calendário de Brasília (ver format-date.ts) — antes
  // usava UTC e virava o dia 3h mais cedo.
  const todayKey = dayKeyBR(new Date());

  const tasksByDay = new Map<string, CalendarTask[]>();
  for (const task of rows) {
    if (!task.dueAt) continue;
    const key = dueDateKey(task.dueAt);
    const list = tasksByDay.get(key) ?? [];
    list.push(task);
    tasksByDay.set(key, list);
  }

  const prevMonth = new Date(Date.UTC(year, monthIndex0 - 1, 1));
  const nextMonth = new Date(Date.UTC(year, monthIndex0 + 1, 1));
  const monthHref = (m: string) => `/dashboard/tarefas?view=calendario&month=${m}`;

  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, key: `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}` });
  }

  // Soltar o card em outro dia = mudar o prazo (2026-09-04). Atualiza a
  // tela na hora e manda pro servidor; se falhar, volta o card pro dia de
  // origem e mostra o motivo.
  async function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id);
    const targetKey = event.over ? String(event.over.id) : null;
    if (!targetKey) return;
    const task = rows.find((t) => t.id === taskId);
    if (!task || !task.dueAt || dueDateKey(task.dueAt) === targetKey) return;

    const previous = rows;
    const nextDueAt = `${targetKey}T00:00:00.000Z`;
    setError(null);
    setRows(previous.map((t) => (t.id === taskId ? { ...t, dueAt: nextDueAt } : t)));

    const res = await moveTaskDueDateAction(taskId, targetKey);
    if (!res.ok) {
      setRows(previous);
      setError(res.message);
      return;
    }
    window.dispatchEvent(new CustomEvent("crm:toast", { detail: `Prazo alterado para ${formatDateOnlyBR(nextDueAt)}` }));
  }

  return (
    <div className="panel">
      <div className="panel-body">
        <div className="cal-head">
          <div className="cal-title">
            {MONTH_NAMES[monthIndex0]} {year}
          </div>
          <div className="cal-nav">
            <Link href={monthHref(monthKey(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth()))} className="btn btn-sm">
              ‹ anterior
            </Link>
            <Link href={monthHref(monthKey(now.getUTCFullYear(), now.getUTCMonth()))} className="btn btn-sm">
              hoje
            </Link>
            <Link href={monthHref(monthKey(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth()))} className="btn btn-sm">
              próximo ›
            </Link>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Arraste uma tarefa para outro dia pra mudar o prazo.
        </div>

        <DndContext sensors={sensors} onDragEnd={(event) => void handleDragEnd(event)}>
          <div className="calendar-grid">
            {WEEKDAYS.map((w) => (
              <div key={w} className="calendar-weekday">
                {w}
              </div>
            ))}
            {cells.map((cell, idx) =>
              cell === null ? (
                <div key={`blank-${idx}`} className="calendar-day empty" />
              ) : (
                <DayCell
                  key={cell.key}
                  dayKey={cell.key}
                  day={cell.day}
                  isToday={cell.key === todayKey}
                  tasks={tasksByDay.get(cell.key) ?? []}
                  todayKey={todayKey}
                />
              ),
            )}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
