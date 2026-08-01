"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Company, Opportunity, Task, TaskList } from "@/lib/api/types";
import { moveTaskAction } from "./actions";

function targetLabel(
  task: Task,
  companies: Company[],
  opportunities: Opportunity[],
): string {
  if (task.companyId) return companies.find((c) => c.id === task.companyId)?.name ?? "—";
  if (task.opportunityId) {
    const opp = opportunities.find((o) => o.id === task.opportunityId);
    return opp ? (companies.find((c) => c.id === opp.companyId)?.name ?? "—") : "—";
  }
  return "—";
}

function isOverdue(task: Task): boolean {
  return task.status === "pending" && task.dueAt !== null && new Date(task.dueAt) < new Date();
}

function Card({
  task,
  cardHref,
  companies,
  opportunities,
}: {
  task: Task;
  cardHref: string;
  companies: Company[];
  opportunities: Opportunity[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className="kanban-card"
    >
      <Link href={cardHref} className="kanban-card-link">
        <div className="company">{targetLabel(task, companies, opportunities)}</div>
        <div className="task-title">{task.title}</div>
        <div className="row-form" style={{ marginTop: 6 }}>
          {task.dueAt && (
            <span className={isOverdue(task) ? "badge badge-danger" : "badge"}>
              {new Date(task.dueAt).toLocaleDateString("pt-BR")}
            </span>
          )}
          {task.status === "done" && <span className="badge badge-accent">Concluída</span>}
          {task._count && task._count.comments > 0 && (
            <span className="badge" title="Comentários">💬 {task._count.comments}</span>
          )}
          {task._count && task._count.checklistItems > 0 && (
            <span className="badge" title="Itens de checklist">☑ {task._count.checklistItems}</span>
          )}
          {task._count && task._count.attachments > 0 && (
            <span className="badge" title="Anexos">📎 {task._count.attachments}</span>
          )}
        </div>
      </Link>
    </div>
  );
}

export default function KanbanBoard({
  lists,
  tasks,
  companies,
  opportunities,
  baseHref,
}: {
  lists: TaskList[];
  tasks: Task[];
  companies: Company[];
  opportunities: Opportunity[];
  baseHref: string;
}) {
  const sortedLists = useMemo(() => [...lists].sort((a, b) => a.order - b.order), [lists]);

  const [byList, setByList] = useState<Record<string, Task[]>>(() => groupTasks(tasks, sortedLists));
  useEffect(() => {
    setByList(groupTasks(tasks, sortedLists));
  }, [tasks, sortedLists]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function findListOf(taskId: string): string | undefined {
    return Object.keys(byList).find((listId) => byList[listId].some((t) => t.id === taskId));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const taskId = String(active.id);
    const sourceListId = findListOf(taskId);
    if (!sourceListId) return;

    // Solto em cima de outro card (usa a coluna dele) ou direto na coluna
    // vazia (over.id é o id da própria coluna nesse caso).
    const overId = String(over.id);
    const destListId = byList[overId] ? overId : findListOf(overId);
    if (!destListId) return;

    const sourceCards = byList[sourceListId];
    const destCards = sourceListId === destListId ? sourceCards : byList[destListId];
    const draggedTask = sourceCards.find((t) => t.id === taskId);
    if (!draggedTask) return;

    const overIndex = destCards.findIndex((t) => t.id === overId);
    const insertIndex = overIndex >= 0 ? overIndex : destCards.length;

    const newDestCards = destCards.filter((t) => t.id !== taskId);
    newDestCards.splice(insertIndex, 0, draggedTask);

    const before = newDestCards[insertIndex - 1];
    const after = newDestCards[insertIndex + 1];
    const newPosition =
      before && after
        ? (before.position + after.position) / 2
        : before
          ? before.position + 1
          : after
            ? after.position - 1
            : 0;

    setByList((prev) => {
      const next = { ...prev };
      next[sourceListId] = prev[sourceListId].filter((t) => t.id !== taskId);
      next[destListId] = newDestCards;
      return next;
    });

    const result = await moveTaskAction(taskId, destListId, newPosition);
    if (!result.ok) {
      // Reverte otimisticamente em caso de erro (ex.: 404 se outra aba já
      // moveu/excluiu o cartão nesse meio-tempo).
      setByList(groupTasks(tasks, sortedLists));
    }
  }

  const activeTask = activeId
    ? Object.values(byList).flat().find((t) => t.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban">
        {sortedLists.map((list) => {
          const cards = byList[list.id] ?? [];
          return (
            <div key={list.id} className="kanban-column">
              <div className="kanban-column-head">
                <span>{list.name}</span>
                <span className="count">{cards.length}</span>
              </div>
              <SortableContext
                id={list.id}
                items={cards.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <DroppableColumn listId={list.id} empty={cards.length === 0}>
                  {cards.map((task) => (
                    <Card
                      key={task.id}
                      task={task}
                      cardHref={`${baseHref}&card=${task.id}`}
                      companies={companies}
                      opportunities={opportunities}
                    />
                  ))}
                </DroppableColumn>
              </SortableContext>
            </div>
          );
        })}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="kanban-card dragging">
            <div className="task-title">{activeTask.title}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function groupTasks(tasks: Task[], lists: TaskList[]): Record<string, Task[]> {
  const map: Record<string, Task[]> = {};
  for (const list of lists) map[list.id] = [];
  for (const task of [...tasks].sort((a, b) => a.position - b.position)) {
    (map[task.listId] ??= []).push(task);
  }
  return map;
}

function DroppableColumn({
  listId,
  empty,
  children,
}: {
  listId: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  // useDroppable pra coluna inteira aceitar o drop mesmo quando vazia
  // (sem nenhum card-alvo pra colidir via useSortable).
  const { setNodeRef } = useDroppable({ id: listId });
  return (
    <div ref={setNodeRef} style={{ minHeight: 40 }}>
      {children}
      {empty && <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Vazio</p>}
    </div>
  );
}
