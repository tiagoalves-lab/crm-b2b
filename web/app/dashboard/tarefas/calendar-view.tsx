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
import {
  dayKeyBR,
  formatDateOnlyBR,
  formatPrazoBR,
  inputLocalParaISO,
  isoParaInputLocal,
} from "@/lib/format-date";
import { moveOpportunityCloseDateAction } from "../pipeline/actions";
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
  // Prazo com hora marcada (2026-09-23) — muda em que dia o card cai
  // (instante real em Brasília × meia-noite UTC) e o que o arrasto grava.
  dueHasTime: boolean;
  done: boolean;
  tipoLabel: string;
  assigneeLabel: string;
  vinculoLabel: string;
}

// Oportunidade do Pipeline no calendário: só as que estão em "Negociação e
// Fechamento" (pedido do usuário, 2026-09-16 — as das etapas de proposta
// ficam só no quadro), no dia da previsão de fechamento. Arrasta igual
// tarefa: soltar em outro dia muda a previsão de fechamento (o prazo SLA
// não mexe — ele é da proposta, não da negociação). `version` vai junto
// porque a gravação usa concorrência otimista.
export interface CalendarOpportunity {
  id: string;
  version: number;
  closeDate: string;
  companyLabel: string;
  amountLabel: string;
  ownerLabel: string;
}

// Id do arrasto das oportunidades — separa das tarefas no mesmo DndContext.
const OPP_PREFIX = "opp:";

// Prazo só-data vem de um <input type="date"> — o backend grava como
// meia-noite UTC, e agrupar por toISOString().slice(0,10) evita o dia
// "vazar" pro anterior por causa de fuso local (bug clássico de calendário
// com Date local vs. UTC).
//
// Prazo COM hora (2026-09-23) é o contrário: é instante real, então o dia
// é aquele em que ele cai em BRASÍLIA. Uma reunião às 22h de segunda é
// 01h de terça em UTC — pela régua de cima cairia no dia errado.
function dueDateKey(dueAt: string, comHora = false): string {
  if (comHora) return dayKeyBR(new Date(dueAt));
  return new Date(dueAt).toISOString().slice(0, 10);
}

function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

// Card arrastável (2026-09-04): o wrapper recebe os listeners do
// @dnd-kit e o Link de dentro continua abrindo a ficha — o PointerSensor
// só ativa o arraste depois de 8px de movimento, então clique é clique.
// Visual único pra tarefa e oportunidade (pedido do usuário, 2026-09-16):
// o atraso segue no texto de ajuda do card, não na cor.
function TaskCard({ task, overdue }: { task: CalendarTask; overdue: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const className = ["calendar-task", task.done ? "done" : "", isDragging ? "dragging" : ""].filter(Boolean).join(" ");

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      className={className}
      title={`${task.title} · ${task.tipoLabel} · ${task.assigneeLabel} · ${task.vinculoLabel}${overdue ? " · prazo vencido" : ""}`}
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

// "Pipeline" em vez de "Proposta" (pedido do usuário, 2026-09-16):
// "Proposta" já é um tipo de tarefa, e os dois se confundiam no calendário.
function OpportunityCard({ opp, overdue }: { opp: CalendarOpportunity; overdue: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${OPP_PREFIX}${opp.id}` });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      className={`calendar-task calendar-opp${isDragging ? " dragging" : ""}`}
      title={`Pipeline · ${opp.companyLabel} · ${opp.amountLabel} · ${opp.ownerLabel}${overdue ? " · previsão vencida" : ""}`}
    >
      <Link href={`/dashboard/pipeline/${opp.id}`}>
        <div className="calendar-task-title">{opp.companyLabel}</div>
        <div className="calendar-task-meta">
          <span><span className="calendar-opp-tag">Pipeline</span> · {opp.amountLabel}</span>
          <span>{opp.ownerLabel}</span>
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
  opportunities,
  todayKey,
}: {
  dayKey: string;
  day: number;
  isToday: boolean;
  tasks: CalendarTask[];
  opportunities: CalendarOpportunity[];
  todayKey: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey });
  const className = ["calendar-day", isToday ? "today" : "", isOver ? "drag-over" : ""].filter(Boolean).join(" ");
  return (
    <div ref={setNodeRef} className={className}>
      <div className="calendar-day-number">{day}</div>
      {opportunities.map((opp) => (
        <OpportunityCard key={opp.id} opp={opp} overdue={dayKey < todayKey} />
      ))}
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} overdue={!task.done && dayKey < todayKey} />
      ))}
    </div>
  );
}

export default function CalendarView({
  tasks,
  opportunities = [],
  month,
}: {
  tasks: CalendarTask[];
  opportunities?: CalendarOpportunity[];
  month?: string;
}) {
  const [rows, setRows] = useState(tasks);
  const [opps, setOpps] = useState(opportunities);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setRows(tasks), [tasks]);
  useEffect(() => setOpps(opportunities), [opportunities]);
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
    const key = dueDateKey(task.dueAt, task.dueHasTime);
    const list = tasksByDay.get(key) ?? [];
    list.push(task);
    tasksByDay.set(key, list);
  }

  // Previsão de fechamento é data sem hora (meia-noite UTC), mesma
  // chave de dia do prazo das tarefas.
  const oppsByDay = new Map<string, CalendarOpportunity[]>();
  for (const opp of opps) {
    const key = dueDateKey(opp.closeDate);
    const list = oppsByDay.get(key) ?? [];
    list.push(opp);
    oppsByDay.set(key, list);
  }

  const prevMonth = new Date(Date.UTC(year, monthIndex0 - 1, 1));
  const nextMonth = new Date(Date.UTC(year, monthIndex0 + 1, 1));
  const monthHref = (m: string) => `/dashboard/tarefas?view=calendario&month=${m}`;

  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, key: `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}` });
  }

  // Soltar o card em outro dia = mudar a data (2026-09-04; oportunidade
  // desde 2026-09-16). Atualiza a tela na hora e manda pro servidor; se
  // falhar, volta o card pro dia de origem e mostra o motivo.
  async function handleDragEnd(event: DragEndEvent) {
    const draggedId = String(event.active.id);
    const targetKey = event.over ? String(event.over.id) : null;
    if (!targetKey) return;
    const nextDate = `${targetKey}T00:00:00.000Z`;

    if (draggedId.startsWith(OPP_PREFIX)) {
      const oppId = draggedId.slice(OPP_PREFIX.length);
      const opp = opps.find((o) => o.id === oppId);
      if (!opp || dueDateKey(opp.closeDate) === targetKey) return;
      const previous = opps;
      setError(null);
      setOpps(previous.map((o) => (o.id === oppId ? { ...o, closeDate: nextDate } : o)));
      const res = await moveOpportunityCloseDateAction(oppId, opp.version, targetKey);
      if (!res.ok) {
        setOpps(previous);
        setError(res.message);
        return;
      }
      // Versão nova: um segundo arrasto do mesmo card não pode esbarrar
      // na concorrência otimista com a versão velha.
      setOpps((atual) => atual.map((o) => (o.id === oppId ? { ...o, version: res.data.version } : o)));
      window.dispatchEvent(
        new CustomEvent("crm:toast", { detail: `Previsão de fechamento alterada para ${formatDateOnlyBR(nextDate)}` }),
      );
      return;
    }

    const task = rows.find((t) => t.id === draggedId);
    if (!task || !task.dueAt || dueDateKey(task.dueAt, task.dueHasTime) === targetKey) return;
    // Tarefa com hora marcada troca de DIA e mantém o HORÁRIO — arrastar
    // uma reunião das 14h pro dia seguinte não pode virar meia-noite.
    const horaOriginal = task.dueHasTime ? isoParaInputLocal(task.dueAt).slice(11, 16) : null;
    const novoPrazo = horaOriginal
      ? inputLocalParaISO(`${targetKey}T${horaOriginal}`)
      : nextDate;
    const previous = rows;
    setError(null);
    setRows(previous.map((t) => (t.id === draggedId ? { ...t, dueAt: novoPrazo } : t)));
    const res = await moveTaskDueDateAction(
      draggedId,
      targetKey,
      horaOriginal ? novoPrazo : undefined,
    );
    if (!res.ok) {
      setRows(previous);
      setError(res.message);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("crm:toast", {
        detail: `Prazo alterado para ${formatPrazoBR(novoPrazo, Boolean(horaOriginal))}`,
      }),
    );
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
          Arraste um card para outro dia: tarefa muda o prazo; oportunidade do Pipeline em Negociação e Fechamento
          muda a previsão de fechamento.
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
                  opportunities={oppsByDay.get(cell.key) ?? []}
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
