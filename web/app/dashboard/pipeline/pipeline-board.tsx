"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
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
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { companyRazaoSocialName } from "@/lib/api/companies";
import type { Membership, Opportunity, Stage } from "@/lib/api/types";
import { formatDateBR, formatDateOnlyBR } from "@/lib/format-date";
import { moveOpportunityStageAction, reorderOpportunitiesAction } from "./actions";
import { calcularSla, ehEtapaDeProposta, slaSelo, slaTitulo, type SlaTratamento } from "./sla";
import { stageColor } from "./stage-colors";
import { useTopbarQuery } from "@/app/_components/topbar-filter";

function brlFull(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function Card({
  opp,
  companyName,
  ownerName,
  color,
}: {
  opp: Opportunity;
  companyName: string;
  ownerName: string;
  color: string;
}) {
  // useSortable (e não só useDraggable): o card também é ALVO de soltar,
  // pra dar pra reordenar dentro da coluna (2026-09-14).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: opp.id });
  const sla = calcularSla(opp);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: color,
      }}
      {...attributes}
      {...listeners}
      className="card"
    >
      <Link href={`/dashboard/pipeline/${opp.id}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
        {/* SLA no canto superior direito — SLA automático da proposta
            (2026-09-16). Ver sla.ts. */}
        <span className="card-sla" title={slaTitulo(sla)}>
          {slaSelo(sla)}
        </span>
        <div className="card-co">{companyName}</div>
        {/* Representante logo abaixo da razão social (pedido do usuário,
            2026-09-11): saber de quem é o negócio sem abrir o card. */}
        <div className="card-rep">{ownerName}</div>
        {/* Abertura e fechamento no próprio card (2026-09-14). Card no
            quadro é sempre oportunidade aberta, então a segunda data é a
            previsão de fechamento; a data real aparece no card já
            encerrado, na lista de baixo. */}
        <div className="card-datas">
          Aberta {formatDateBR(opp.createdAt)} · Previsão{" "}
          {opp.expectedCloseDate ? formatDateOnlyBR(opp.expectedCloseDate) : "—"}
        </div>
        {/* O círculo com as iniciais do representante saiu daqui a pedido
            do usuário (2026-09-14) — o nome dele já está logo abaixo da
            razão social, e o espaço passou a ser do alerta de pendência:
            alguém destacou você num comentário deste card e você ainda
            não deu baixa. */}
        <div className="card-foot">
          <span className="card-val">{brlFull(Number(opp.amount), opp.currency)}</span>
          {opp.pendenciaParaMim && (
            <span className="card-pendencia" title="Você foi destacado num comentário deste card">
              <span aria-hidden="true">⚠</span> Pendência(s) para você
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}

function Column({
  stage,
  opportunities,
  companyName,
  ownerNameOf,
}: {
  stage: Stage;
  opportunities: Opportunity[];
  companyName: (opp: Opportunity) => string;
  ownerNameOf: (id: string) => string;
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
        <SortableContext
          items={opportunities.map((o) => o.id)}
          strategy={verticalListSortingStrategy}
        >
          {opportunities.map((opp) => (
          <Card
            key={opp.id}
            opp={opp}
            companyName={companyName(opp)}
            ownerName={ownerNameOf(opp.ownerUserId)}
            color={color}
          />
          ))}
        </SortableContext>
        {opportunities.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "0 2px" }}>Vazio</p>
        )}
      </div>
    </div>
  );
}

// Board com drag-and-drop real (SPEC-CRM-GAMA.md §4.2) — arrastar entre
// stages move a oportunidade (UPDATE stage_id) e, desde 2026-09-14,
// arrastar dentro da coluna grava a ORDEM dos cards (Opportunity.position),
// que é como o usuário organiza prioridade. Cada coluna é uma zona de drop
// (useDroppable, pra coluna vazia) com um SortableContext dentro (pros
// cards serem alvo uns dos outros).
// Busca client-side (protótipo: filterDeals) embutida aqui porque todo
// dado já chega via props — não precisa de ida-e-volta ao servidor.
export default function PipelineBoard({
  stages,
  openOpportunities,
  currentUserId,
  memberships,
}: {
  stages: Stage[];
  openOpportunities: Opportunity[];
  currentUserId: string;
  // Nome do representante no card (2026-09-11) — a lista de membros vem
  // da página, que já a carrega pra isso.
  memberships: Membership[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(openOpportunities);
  useEffect(() => setItems(openOpportunities), [openOpportunities]);

  // Texto do filtro do cabeçalho (TopbarFilter em modo contexto) — a busca
  // antiga da toolbar saiu em 2026-09-03 pra não duplicar. Continua
  // filtrando aqui (e não por DOM) pra contagem e soma das colunas baterem.
  const query = useTopbarQuery();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [perguntaSla, setPerguntaSla] = useState<{
    etapa: string;
    resolve: (escolha: SlaTratamento | null) => void;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Nome da empresa vem embutido em cada oportunidade (GET /opportunities,
  // 2026-09-04) — o board não recebe mais a base de empresas por prop.
  // Razão social no card (pedido do usuário, 2026-09-11), com a fantasia
  // só como reserva pra empresa cadastrada sem razão social.
  const companyName = (opp: Opportunity) => (opp.company ? companyRazaoSocialName(opp.company) : "—");
  // Representante do card (2026-09-11): nome do membro, mesma regra do
  // card de detalhe (memberDisplayName). Antes o avatar mostrava dois
  // caracteres do id ("12", "CD"), que não diziam nada.
  const ownerNameOf = (id: string) => {
    const m = memberships.find((mm) => mm.userId === id);
    const nome = m?.name?.trim() || m?.login?.trim();
    if (nome) return nome;
    return id === currentUserId ? "Você" : "Sem representante";
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((o) => companyName(o).toLowerCase().includes(q));
  }, [items, query]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  // Arrastar entre colunas (muda a etapa) E dentro da coluna (muda a
  // ordem — prioridade, pedido do usuário em 2026-09-14). O alvo do
  // soltar pode ser a coluna (zona vazia) ou outro card: no segundo caso
  // a etapa de destino é a DAQUELE card, e a posição é a dele.
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const oppId = String(active.id);
    const overId = String(over.id);
    if (oppId === overId) return;

    const opp = items.find((o) => o.id === oppId);
    if (!opp) return;

    const ehColuna = stages.some((s) => s.id === overId);
    const destStageId = ehColuna ? overId : items.find((o) => o.id === overId)?.stageId;
    if (!destStageId) return;

    // Coluna de destino sem o card arrastado, na ordem em que está na
    // tela, com o card inserido no lugar onde foi solto.
    const destino = items.filter((o) => o.stageId === destStageId && o.id !== oppId);
    const alvo = ehColuna ? -1 : destino.findIndex((o) => o.id === overId);
    const posicao = alvo < 0 ? destino.length : alvo;
    destino.splice(posicao, 0, { ...opp, stageId: destStageId });

    const mudouDeEtapa = opp.stageId !== destStageId;
    const outros = items.filter((o) => o.id !== oppId && o.stageId !== destStageId);
    setItems([...outros, ...destino]);

    function reverter() {
      // Reverte pro que o servidor tem. router.refresh() em vez de confiar
      // só na prop: `openOpportunities` vem do closure deste render e pode
      // estar tão velha quanto o estado que acabou de falhar.
      setItems(openOpportunities);
      router.refresh();
    }

    // Voltar de Negociação para uma etapa de proposta (SLA automático,
    // 2026-09-16): antes de gravar, pergunta o tratamento do SLA. O card
    // já aparece na coluna nova; cancelar devolve ele.
    let slaTratamento: SlaTratamento | undefined;
    if (mudouDeEtapa) {
      const de = stages.find((s) => s.id === opp.stageId);
      const para = stages.find((s) => s.id === destStageId);
      if (de && para && !ehEtapaDeProposta(de) && ehEtapaDeProposta(para)) {
        const escolha = await new Promise<SlaTratamento | null>((resolve) =>
          setPerguntaSla({ etapa: para.name, resolve }),
        );
        setPerguntaSla(null);
        if (!escolha) {
          setItems(items);
          return;
        }
        slaTratamento = escolha;
      }
    }

    if (mudouDeEtapa) {
      const result = await moveOpportunityStageAction(oppId, destStageId, opp.version, slaTratamento);
      if (!result.ok) {
        reverter();
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

    // Grava a ordem da coluna de destino. Não mexe na versão das
    // oportunidades (ver OpportunityService#reorder), então não briga com
    // um card aberto em outra aba.
    const ordem = await reorderOpportunitiesAction(
      destStageId,
      destino.map((o) => o.id),
    );
    if (!ordem.ok) reverter();
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
              ownerNameOf={ownerNameOf}
            />
          ))}
        </div>
        <DragOverlay>
          {activeOpp ? (
            <div className="card dragging" style={{ borderLeftColor: stageColor(stages.find((s) => s.id === activeOpp.stageId)?.order ?? 1) }}>
              <span className="card-sla">{slaSelo(calcularSla(activeOpp))}</span>
              <div className="card-co">{companyName(activeOpp)}</div>
              <div className="card-rep">{ownerNameOf(activeOpp.ownerUserId)}</div>
              <div className="card-foot">
                <span className="card-val">{brlFull(Number(activeOpp.amount), activeOpp.currency)}</span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {perguntaSla && (
        <div className="overlay open" onClick={() => perguntaSla.resolve(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Por que a proposta voltou?</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => perguntaSla.resolve(null)}
                aria-label="Cancelar"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                O card vai voltar para <strong>{perguntaSla.etapa}</strong>. Escolha como o SLA deve ser tratado:
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ textAlign: "left", display: "block", padding: "12px 14px", height: "auto", whiteSpace: "normal" }}
                  onClick={() => perguntaSla.resolve("erro_elaboracao")}
                >
                  <strong>Erro na elaboração da proposta</strong>
                  <span className="field-hint" style={{ display: "block", marginTop: 4 }}>
                    Não reinicia o SLA: a contagem continua desde a abertura até o novo fechamento.
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ textAlign: "left", display: "block", padding: "12px 14px", height: "auto", whiteSpace: "normal" }}
                  onClick={() => perguntaSla.resolve("alteracao_cliente")}
                >
                  <strong>Solicitação de alteração pelo cliente</strong>
                  <span className="field-hint" style={{ display: "block", marginTop: 4 }}>
                    Reinicia o SLA a partir de hoje (data de revisão).
                  </span>
                </button>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => perguntaSla.resolve(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
