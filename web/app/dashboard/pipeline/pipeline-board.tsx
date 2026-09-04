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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { companyDisplayName } from "@/lib/api/companies";
import type { Opportunity, Stage } from "@/lib/api/types";
import { moveOpportunityStageAction } from "./actions";
import { stageColor } from "./stage-colors";
import { useTopbarQuery } from "@/app/_components/topbar-filter";

function brlFull(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function Card({
  opp,
  companyName,
  ownerInitials,
  color,
}: {
  opp: Opportunity;
  companyName: string;
  ownerInitials: string;
  color: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opp.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: color,
      }}
      {...attributes}
      {...listeners}
      className="card"
    >
      <Link href={`/dashboard/pipeline/${opp.id}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
        <div className="card-co">{companyName}</div>
        <div className="card-foot">
          <span className="card-val">{brlFull(Number(opp.amount), opp.currency)}</span>
          <span className="mini-avatar" title={ownerInitials}>
            {ownerInitials}
          </span>
        </div>
      </Link>
    </div>
  );
}

function Column({
  stage,
  opportunities,
  companyName,
  ownerInitialsOf,
}: {
  stage: Stage;
  opportunities: Opportunity[];
  companyName: (opp: Opportunity) => string;
  ownerInitialsOf: (id: string) => string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const color = stageColor(stage.order);
  const sum = opportunities.reduce((s, o) => s + Number(o.amount), 0);

  return (
    <div key={stage.id} className={isOver ? "col drag-over" : "col"}>
      <div className="col-head">
        <div className="col-head-top">
          <div className="col-name">
            <span className="col-dot" style={{ background: color }} />
            {stage.name}
          </div>
          <span className="col-count">{opportunities.length}</span>
        </div>
        <div className="col-sum">{sum > 0 ? sum.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</div>
      </div>
      <div ref={setNodeRef} className="col-body">
        {opportunities.map((opp) => (
          <Card
            key={opp.id}
            opp={opp}
            companyName={companyName(opp)}
            ownerInitials={ownerInitialsOf(opp.ownerUserId)}
            color={color}
          />
        ))}
        {opportunities.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "0 2px" }}>Vazio</p>
        )}
      </div>
    </div>
  );
}

// Board com drag-and-drop real (SPEC-CRM-GAMA.md §4.2) — arrastar entre
// stages move a oportunidade (UPDATE stage_id). Sem posição/ordem dentro
// da coluna (Opportunity não tem campo de ordenação, diferente de Task),
// então cada coluna é só uma zona de drop (useDroppable), não uma
// SortableContext (sem reordenar dentro da coluna, só entre colunas).
// Busca client-side (protótipo: filterDeals) embutida aqui porque todo
// dado já chega via props — não precisa de ida-e-volta ao servidor.
export default function PipelineBoard({
  stages,
  openOpportunities,
  currentUserId,
}: {
  stages: Stage[];
  openOpportunities: Opportunity[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(openOpportunities);
  useEffect(() => setItems(openOpportunities), [openOpportunities]);

  // Texto do filtro do cabeçalho (TopbarFilter em modo contexto) — a busca
  // antiga da toolbar saiu em 2026-09-03 pra não duplicar. Continua
  // filtrando aqui (e não por DOM) pra contagem e soma das colunas baterem.
  const query = useTopbarQuery();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Nome da empresa vem embutido em cada oportunidade (GET /opportunities,
  // 2026-09-04) — o board não recebe mais a base de empresas por prop.
  const companyName = (opp: Opportunity) => (opp.company ? companyDisplayName(opp.company) : "—");
  // Membership não guarda e-mail/nome (só userId, ver dashboard/membros/
  // page.tsx) — mesmo fallback usado lá: "Você" para o usuário atual,
  // prefixo do id pros demais.
  const ownerInitialsOf = (id: string) => (id === currentUserId ? "VC" : id.slice(0, 2).toUpperCase());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((o) => companyName(o).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query]);

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
    setItems((prev) => prev.map((o) => (o.id === oppId ? { ...o, stageId: destStageId } : o)));

    const result = await moveOpportunityStageAction(oppId, destStageId, version);
    if (!result.ok) {
      // Reverte pro que o servidor tem. router.refresh() em vez de confiar
      // só na prop: `openOpportunities` vem do closure deste render e pode
      // estar tão velha quanto o estado que acabou de falhar.
      setItems(openOpportunities);
      router.refresh();
      return;
    }

    // Aplica o version devolvido pelo servidor na hora, sem esperar a
    // revalidação chegar. É isso que permite arrastar o mesmo cartão
    // várias vezes seguidas sem tomar 409 e ver o cartão voltar (ver
    // comentário em moveOpportunityStageAction).
    const novaVersao = result.version;
    if (typeof novaVersao === "number") {
      setItems((prev) =>
        prev.map((o) => (o.id === oppId ? { ...o, version: novaVersao } : o)),
      );
    }
  }

  const activeOpp = activeId ? filtered.find((o) => o.id === activeId) : null;

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className={`board b${Math.max(stages.length, 1)}`}>
          {stages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              opportunities={filtered.filter((o) => o.stageId === stage.id)}
              companyName={companyName}
              ownerInitialsOf={ownerInitialsOf}
            />
          ))}
        </div>
        <DragOverlay>
          {activeOpp ? (
            <div className="card dragging" style={{ borderLeftColor: stageColor(stages.find((s) => s.id === activeOpp.stageId)?.order ?? 1) }}>
              <div className="card-co">{companyName(activeOpp)}</div>
              <div className="card-foot">
                <span className="card-val">{brlFull(Number(activeOpp.amount), activeOpp.currency)}</span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
