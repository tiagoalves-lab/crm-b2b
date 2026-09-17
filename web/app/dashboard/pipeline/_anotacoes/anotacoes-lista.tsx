"use client";

import Link from "next/link";
import { useState } from "react";
import { companyRazaoSocialName } from "@/lib/api/companies";
import type { Membership, OpportunityCommentFeedItem } from "@/lib/api/types";
import { formatDateTimeBR } from "@/lib/format-date";
import { markAllCommentsReadAction, setCommentReadAction } from "../actions";
import { TagChips } from "../_detail/item-tags";

// Histórico de anotações dos cards do Pipeline (2026-09-09): tudo que foi
// comentado nos cards, em ordem cronológica invertida, com as anotações
// FIXADAS abertas em cima — é pra isso que existe o botão "Fixar" dentro
// do card (opportunity-detail.tsx). Cada linha leva de volta ao card que
// a originou.
//
// Lido / não lido (pedido do usuário, 2026-09-17, no molde das
// notificações do Trello): bolinha em cada anotação, "Mostrar apenas não
// lidas" e "Marcar tudo como lido". Cada pessoa tem a própria marcação.
// Quem entra na lista é a regra do backend (o representante só vê
// anotação dos cards dele). Client component desde então: cada clique
// grava e atualiza o estado local, sem recarregar a lista.

const STATUS_LABEL: Record<string, string> = {
  won: "Fechada",
  lost: "Perdida",
};

function autorDaAnotacao(item: OpportunityCommentFeedItem, memberships: Membership[]): string {
  // Mesma regra do card: mensagem espelhada de fora traz o nome de quem
  // escreveu lá; o autor interno nesse caso é o usuário de sistema.
  const externo = item.externalAuthor?.trim() ?? "";
  if (externo) return `${externo} · via Trello`;
  const m = memberships.find((mm) => mm.userId === item.authorUserId);
  return m?.name?.trim() || m?.login?.trim() || `${item.authorUserId.slice(0, 8)}…`;
}

function Anotacao({
  item,
  memberships,
  ocupado,
  onToggleLido,
}: {
  item: OpportunityCommentFeedItem;
  memberships: Membership[];
  ocupado: boolean;
  onToggleLido: () => void;
}) {
  const fixada = Boolean(item.pinnedAt);
  const empresa = item.opportunity.company
    ? companyRazaoSocialName(item.opportunity.company)
    : "Empresa sem nome";
  const situacao = STATUS_LABEL[item.opportunity.status];
  const classes = ["anotacoes-item", fixada ? "fixada" : "", item.lido ? "" : "nao-lida"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="anotacoes-head">
        {fixada && <span className="chat-pin-tag">📌 Fixada</span>}
        <Link href={`/dashboard/pipeline/${item.opportunity.id}`} className="anotacoes-empresa">
          {empresa}
        </Link>
        {situacao && <span className="anotacoes-meta">{situacao}</span>}
        <span className="anotacoes-meta direita">
          {autorDaAnotacao(item, memberships)} · {formatDateTimeBR(item.createdAt)}
        </span>
        <button
          type="button"
          className={item.lido ? "anotacoes-lido lido" : "anotacoes-lido"}
          title={item.lido ? "Marcar como não lido" : "Marcar como lido"}
          aria-label={item.lido ? "Marcar como não lido" : "Marcar como lido"}
          aria-busy={ocupado || undefined}
          disabled={ocupado}
          onClick={onToggleLido}
        />
      </div>
      <div className="anotacoes-texto">{item.body}</div>
      <TagChips tags={item.tags ?? []} />
    </div>
  );
}

export default function AnotacoesLista({
  items: iniciais,
  memberships,
}: {
  items: OpportunityCommentFeedItem[];
  memberships: Membership[];
}) {
  const [items, setItems] = useState(iniciais);
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  // "todas" enquanto grava o "Marcar tudo"; id da anotação no clique único.
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const naoLidas = items.filter((i) => !i.lido).length;

  async function alternarLido(item: OpportunityCommentFeedItem) {
    if (ocupado) return;
    setOcupado(item.id);
    setErro(null);
    const res = await setCommentReadAction(item.id, !item.lido);
    setOcupado(null);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, lido: res.data.lido } : i)));
  }

  async function marcarTudo() {
    if (ocupado) return;
    setOcupado("todas");
    setErro(null);
    const res = await markAllCommentsReadAction();
    setOcupado(null);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setItems((prev) => prev.map((i) => ({ ...i, lido: true })));
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        Nenhuma anotação registrada nos cards do Pipeline ainda.
      </div>
    );
  }

  const visiveis = soNaoLidas ? items.filter((i) => !i.lido) : items;
  const fixadas = visiveis.filter((i) => i.pinnedAt);
  const demais = visiveis.filter((i) => !i.pinnedAt);

  const renderizar = (item: OpportunityCommentFeedItem) => (
    <Anotacao
      key={item.id}
      item={item}
      memberships={memberships}
      ocupado={ocupado !== null}
      onToggleLido={() => void alternarLido(item)}
    />
  );

  return (
    <>
      {erro && <div className="error-banner">{erro}</div>}

      <div className="anotacoes-barra">
        <label className="anotacoes-filtro">
          <input
            type="checkbox"
            checked={soNaoLidas}
            onChange={(event) => setSoNaoLidas(event.target.checked)}
          />
          Mostrar apenas não lidas
        </label>
        <span className="anotacoes-meta">
          {naoLidas === 0 ? "Tudo lido" : naoLidas === 1 ? "1 não lida" : `${naoLidas} não lidas`}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm anotacoes-marcar-tudo"
          disabled={ocupado !== null || naoLidas === 0}
          aria-busy={ocupado === "todas" || undefined}
          onClick={() => void marcarTudo()}
        >
          {ocupado === "todas" ? "Marcando…" : "Marcar tudo como lido"}
        </button>
      </div>

      {fixadas.length > 0 && (
        <div className="anotacoes-section">
          <div className="drawer-section-title">Fixadas · {fixadas.length}</div>
          {fixadas.map(renderizar)}
        </div>
      )}
      <div className="anotacoes-section">
        <div className="drawer-section-title">
          {fixadas.length > 0 ? "Demais anotações" : "Anotações"} · {demais.length}
        </div>
        {demais.length > 0 ? (
          demais.map(renderizar)
        ) : (
          <div className="chat-empty">
            {soNaoLidas ? "Nenhuma anotação não lida." : "Nenhuma outra anotação."}
          </div>
        )}
      </div>
    </>
  );
}
