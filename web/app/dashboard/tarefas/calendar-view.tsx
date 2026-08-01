import Link from "next/link";
import type { Task } from "@/lib/api/types";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

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

export default function CalendarView({ tasks, month }: { tasks: Task[]; month?: string }) {
  const now = new Date();
  const [yearStr, monthStr] = (month ?? monthKey(now.getUTCFullYear(), now.getUTCMonth())).split("-");
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;

  const firstOfMonth = new Date(Date.UTC(year, monthIndex0, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();
  const todayKey = new Date().toISOString().slice(0, 10);

  const tasksByDay = new Map<string, Task[]>();
  for (const task of tasks) {
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
              <div key={cell.key} className={cell.key === todayKey ? "calendar-day today" : "calendar-day"}>
                <div className="calendar-day-number">{cell.day}</div>
                {(tasksByDay.get(cell.key) ?? []).map((task) => (
                  <Link
                    key={task.id}
                    href={`/dashboard/tarefas/${task.id}`}
                    className={
                      task.status === "done"
                        ? "calendar-task done"
                        : task.status === "pending" && new Date(task.dueAt!) < new Date()
                          ? "calendar-task overdue"
                          : "calendar-task"
                    }
                  >
                    {task.title}
                  </Link>
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
