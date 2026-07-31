"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import type { Company, Opportunity, Stage } from "@/lib/api/types";
import {
  markLostAction,
  markWonAction,
  moveOpportunityStageAction,
} from "./actions";

function Card({
  opp,
  companyName,
}: {
  opp: Opportunity;
  companyName: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opp.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      className="kanban-card"
    >
      {/* Listeners só no "punho" (empresa+valor), não no cartão inteiro —
          senão os botões/input abaixo (forms reais, não navegação como em
          tarefas/kanban-board.tsx) ficam sob risco de interferência do
          pointerdown do dnd-kit. */}
      <div {...attributes} {...listeners} style={{ cursor: "grab" }}>
        <div className="company">{companyName}</div>
        <div className="amount">
          {opp.currency} {Number(opp.amount).toLocaleString("pt-BR")}
        </div>
      </div>

      <form action={markWonAction}>
        <input type="hidden" name="id" value={opp.id} />
        <input type="hidden" name="version" value={opp.version} />
        <button type="submit" className="btn btn-sm btn-primary">
          Ganhar
        </button>
      </form>
      <form action={markLostAction} className="row-form">
        <input type="hidden" name="id" value={opp.id} />
        <input type="hidden" name="version" value={opp.version} />
        <input name="lostReason" placeholder="Motivo" />
        <button type="submit" className="btn btn-sm btn-danger">
          Perder
        </button>
      </form>
    </div>
  );
}

function StageColumn({
  stage,
  opportunities,
  companyName,
}: {
  stage: Stage;
  opportunities: Opportunity[];
  companyName: (id: string) => string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      key={stage.id}
      className="kanban-column"
      style={isOver ? { background: "var(--accent-soft)" } : undefined}
    >
      <div className="kanban-column-head">
        <span>{stage.name}</span>
        <span className="count">{opportunities.length}</span>
      </div>
      <div ref={setNodeRef} style={{ minHeight: 40, display: "flex", flexDirection: "column", gap: 8 }}>
        {opportunities.map((opp) => (
          <Card key={opp.id} opp={opp} companyName={companyName(opp.companyId)} />
        ))}
        {opportunities.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Vazio</p>
        )}
      </div>
    </div>
  );
}

// Board com drag-and-drop real (SPEC-CRM-GAMA.md §4.2) — arrastar entre
// stages move a oportunidade (UPDATE stage_id). Sem posição/ordem dentro
// da coluna (Opportunity não tem campo de ordenação, diferente de Task),
// então cada coluna é só uma zona de drop (useDroppable), não uma
// SortableContext — mesmo @dnd-kit já usado em tarefas/kanban-board.tsx,
// simplificado porque não precisa reordenar.
export default function PipelineBoard({
  stages,
  openOpportunities,
  companies,
}: {
  stages: Stage[];
  openOpportunities: Opportunity[];
  companies: Company[];
}) {
  const [items, setItems] = useState(openOpportunities);
  useEffect(() => setItems(openOpportunities), [openOpportunities]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "—";

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const oppId = String(active.id);
    const destStageId = String(over.id);
    const opp = items.find((o) => o.id === oppId);
    if (!opp || opp.stageId === destStageId) return;

    const version = opp.version;
    setItems((prev) =>
      prev.map((o) => (o.id === oppId ? { ...o, stageId: destStageId } : o)),
    );

    const result = await moveOpportunityStageAction(oppId, destStageId, version);
    if (!result.ok) {
      setItems(openOpportunities);
    }
  }

  const activeOpp = activeId ? items.find((o) => o.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban">
        {stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            opportunities={items.filter((o) => o.stageId === stage.id)}
            companyName={companyName}
          />
        ))}
      </div>
      <DragOverlay>
        {activeOpp ? (
          <div className="kanban-card dragging">
            <div className="company">{companyName(activeOpp.companyId)}</div>
            <div className="amount">
              {activeOpp.currency} {Number(activeOpp.amount).toLocaleString("pt-BR")}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
