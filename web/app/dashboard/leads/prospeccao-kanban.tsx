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
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Contact, RawLead, RawLeadEtapa } from "@/lib/api/types";
import { effectiveTier, ETAPAS_FUNIL, ETAPA_LABEL, TIER_LABEL } from "@/lib/api/raw-leads";
import { formatDateBR } from "@/lib/format-date";
import { moveLeadEtapaAction } from "./actions";

// Quadro Kanban da Prospecção (2026-09-23, pedido do usuário: ver os leads
// "no modo lista e também no modo de Kanban", com o cartão podendo ser
// movido — referência: a tela de Tickets do Auvo).
//
// Uma coluna por etapa do funil (ver lib/api/raw-leads.ts). O arrasto grava
// a etapa na hora (PATCH /raw-leads/:id/etapa) e, se o backend recusar, o
// cartão volta pra coluna de onde saiu.
//
// A última coluna não aceita soltar: a passagem pra Negociação/Fechamento é
// "Converter lead", que exige CNPJ e cria a empresa — arrastar não faria
// isso. Lead descartado não aparece no quadro (tem aba própria).
//
// Molde: pipeline/pipeline-board.tsx, o outro quadro do CRM. A diferença é
// que aqui não existe ordem manual dentro da coluna — cartão de lead não
// tem prioridade gravada. A ordem é a do último contato, do mais recente
// pro mais antigo (ver porEtapa, no fim do arquivo).

const COLUNA_TRAVADA: RawLeadEtapa = "negociacao";

function Card({
  lead,
  contatos,
  representante,
  cor,
  arrastavel,
}: {
  lead: RawLead;
  contatos: Contact[];
  representante: string;
  cor: string;
  arrastavel: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    disabled: !arrastavel,
  });
  const tier = effectiveTier(lead);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: cor,
      }}
      {...attributes}
      {...listeners}
      className="card"
    >
      <Link
        href={`/dashboard/leads/${lead.id}`}
        style={{ display: "block", color: "inherit", textDecoration: "none" }}
      >
        <div className="card-co">
          {lead.razaoSocial}
          {lead.emRecuperacaoJudicial && (
            <span
              title="Em recuperação judicial — indicativo da Receita Federal"
              style={{ color: "var(--danger)", marginLeft: 6 }}
              aria-label="Em recuperação judicial"
            >
              &#9873;
            </span>
          )}
        </div>
        <div className="card-rep">{representante}</div>
        <div className="card-datas">
          {lead.municipio ?? "—"}
          {lead.uf ? `/${lead.uf}` : ""} · {lead.cnpj ?? "sem CNPJ"}
        </div>
        {contatos.length > 0 && (
          <div className="card-datas">
            {contatos[0].nome || "(sem nome)"}
            {contatos.length > 1 ? ` +${contatos.length - 1}` : ""}
            {contatos[0].telefone ? ` · ${contatos[0].telefone}` : ""}
          </div>
        )}
        <div className="card-foot">
          {tier ? (
            <span className={`tier-tag tier-${tier}`}>{TIER_LABEL[tier]}</span>
          ) : (
            <span className="t-sub">sem prazo</span>
          )}
          {lead.ultimoContato && (
            <span className="t-sub">contato {formatDateBR(lead.ultimoContato)}</span>
          )}
        </div>
      </Link>
    </div>
  );
}

// Quantos cartões cada coluna desenha de uma vez. A coluna de entrada tem
// centenas de leads (a base importada inteira), e desenhar tudo é o mesmo
// problema que já travou a lista em 2026-09-18 — aqui é pior, porque cada
// cartão é também um alvo de arrastar.
const PASSO = 30;

function Coluna({
  etapa,
  leads,
  contatosDe,
  representanteDe,
  cor,
}: {
  etapa: RawLeadEtapa;
  leads: RawLead[];
  contatosDe: (lead: RawLead) => Contact[];
  representanteDe: (lead: RawLead) => string;
  cor: string;
}) {
  const travada = etapa === COLUNA_TRAVADA;
  const { setNodeRef, isOver } = useDroppable({ id: etapa, disabled: travada });
  const [limite, setLimite] = useState(PASSO);
  useEffect(() => setLimite(PASSO), [leads.length]);
  const visiveis = leads.slice(0, limite);

  return (
    <div className={isOver && !travada ? "col drag-over" : "col"}>
      <div className="col-head">
        <div className="col-head-top">
          <div className="col-name">
            <span className="col-dot" style={{ background: cor }} />
            {ETAPA_LABEL[etapa]}
          </div>
          <span className="col-count">{leads.length}</span>
        </div>
        {travada && <div className="col-sum">entra por &quot;Converter lead&quot;</div>}
      </div>
      <div ref={setNodeRef} className="col-body">
        <SortableContext items={visiveis.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {visiveis.map((lead) => (
            <Card
              key={lead.id}
              lead={lead}
              contatos={contatosDe(lead)}
              representante={representanteDe(lead)}
              cor={cor}
              arrastavel={!travada}
            />
          ))}
        </SortableContext>
        {leads.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "0 2px" }}>Vazio</p>
        )}
        {leads.length > visiveis.length && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ width: "100%", marginTop: 6 }}
            onClick={() => setLimite((l) => l + PASSO)}
          >
            Mostrar mais ({leads.length - visiveis.length})
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProspeccaoKanban({
  leads,
  contactsByCompanyId,
  nomePorUserId,
  cores,
}: {
  // Leads em triagem + convertidos: o quadro mostra o funil inteiro, da
  // entrada ao fechamento. Descartado fica de fora (tem aba própria).
  leads: RawLead[];
  contactsByCompanyId: Record<string, Contact[]>;
  nomePorUserId: Record<string, string>;
  // Cor por etapa — vem de quem chama pra não duplicar a paleta aqui.
  cores: Record<RawLeadEtapa, string>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(leads);
  useEffect(() => setItems(leads), [leads]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const contatosDe = (lead: RawLead) =>
    lead.promotedCompanyId ? (contactsByCompanyId[lead.promotedCompanyId] ?? []) : [];
  const representanteDe = (lead: RawLead) =>
    lead.ownerUserId ? (nomePorUserId[lead.ownerUserId] ?? "sem dono") : "sem dono";

  const porEtapa = useMemo(() => {
    const mapa = {} as Record<RawLeadEtapa, RawLead[]>;
    for (const etapa of ETAPAS_FUNIL) mapa[etapa] = [];
    for (const lead of items) mapa[lead.etapa]?.push(lead);
    // Ordem da coluna: último contato mais RECENTE primeiro (pedido do
    // usuário, 2026-09-24). Quem nunca teve contato registrado vai pro
    // fim — é fila fria, não topo de prioridade — e entre eles vale a
    // ordem alfabética, que é como a coluna era ordenada inteira antes.
    for (const etapa of ETAPAS_FUNIL) {
      mapa[etapa].sort((a, b) => {
        if (a.ultimoContato && b.ultimoContato) {
          return b.ultimoContato.localeCompare(a.ultimoContato);
        }
        if (a.ultimoContato) return -1;
        if (b.ultimoContato) return 1;
        return a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR");
      });
    }
    return mapa;
  }, [items]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setErro(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const leadId = String(active.id);
    const overId = String(over.id);
    const lead = items.find((l) => l.id === leadId);
    if (!lead) return;

    // O alvo pode ser a coluna (zona vazia) ou outro cartão — no segundo
    // caso vale a etapa daquele cartão. Mesma regra do quadro do Pipeline.
    const ehColuna = (ETAPAS_FUNIL as string[]).includes(overId);
    const destino = ehColuna
      ? (overId as RawLeadEtapa)
      : items.find((l) => l.id === overId)?.etapa;
    if (!destino || destino === lead.etapa || destino === COLUNA_TRAVADA) return;

    const anterior = items;
    setItems((prev) => prev.map((l) => (l.id === leadId ? { ...l, etapa: destino } : l)));

    const res = await moveLeadEtapaAction(leadId, destino);
    if (!res.ok) {
      setItems(anterior);
      setErro(res.message);
      return;
    }
    // O servidor pode ter mexido em mais do que a etapa (a data de
    // qualificação, por exemplo) — router.refresh() traz o lead como ele
    // ficou, sem recarregar a tela.
    router.refresh();
  }

  const ativo = activeId ? items.find((l) => l.id === activeId) : null;

  return (
    <>
      {erro && <div className="error-banner">{erro}</div>}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className={`board b${ETAPAS_FUNIL.length}`}>
          {ETAPAS_FUNIL.map((etapa) => (
            <Coluna
              key={etapa}
              etapa={etapa}
              leads={porEtapa[etapa]}
              contatosDe={contatosDe}
              representanteDe={representanteDe}
              cor={cores[etapa]}
            />
          ))}
        </div>
        <DragOverlay>
          {ativo ? (
            <div className="card dragging" style={{ borderLeftColor: cores[ativo.etapa] } as CSSProperties}>
              <div className="card-co">{ativo.razaoSocial}</div>
              <div className="card-rep">{representanteDe(ativo)}</div>
              <div className="card-datas">
                {ativo.municipio ?? "—"}
                {ativo.uf ? `/${ativo.uf}` : ""}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
