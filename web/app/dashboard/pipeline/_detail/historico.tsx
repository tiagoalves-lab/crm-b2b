"use client";

import type { Activity, Membership, OpportunityWithDetails } from "@/lib/api/types";
import { formatDateBR, formatDateOnlyBR, formatDateTimeBR } from "@/lib/format-date";

// Histórico do card de Oportunidade (2026-09-14): a trilha de auditoria
// que o CRM já grava a cada mudança (Activity — ver
// OpportunityService#update e OpportunityItemService), escrita em
// português. Mostra quando o negócio foi aberto e encerrado, cada troca
// de etapa e cada edição do card, com valor anterior e novo.
//
// O que aparece aqui é gravado pelo backend, nunca pela tela: se a
// gravação mudar de formato, é lá que muda.

const SITUACAO: Record<string, string> = {
  open: "Aberta",
  won: "Fechada",
  lost: "Perdida",
};

const CAMPO: Record<string, string> = {
  amount: "Valor",
  currency: "Moeda",
  expectedCloseDate: "Previsão de fechamento",
  slaDueDate: "Prazo SLA",
  ownerUserId: "Representante",
  description: "Descrição",
  companyId: "Empresa",
};

const SUBTIPO: Record<string, string> = {
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
  nota: "Anotação",
  posvenda: "Pós-venda",
};

function brl(valor: string | null): string {
  if (valor === null) return "—";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function texto(payload: Record<string, unknown>, chave: string): string | null {
  const valor = payload[chave];
  return typeof valor === "string" && valor.trim() ? valor : null;
}

function nomeDoMembro(userId: string | null, memberships: Membership[]): string {
  if (!userId) return "Sistema";
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || "Sistema";
}

// Uma linha de "de → para" já formatada conforme o campo.
function descreveMudanca(
  change: { field?: unknown; from?: unknown; to?: unknown },
  memberships: Membership[],
): string {
  const field = typeof change.field === "string" ? change.field : "";
  const from = typeof change.from === "string" ? change.from : null;
  const to = typeof change.to === "string" ? change.to : null;
  const rotulo = CAMPO[field] ?? field;

  if (field === "amount") return `${rotulo}: ${brl(from)} → ${brl(to)}`;
  if (field === "expectedCloseDate" || field === "slaDueDate") {
    return `${rotulo}: ${from ? formatDateOnlyBR(from) : "—"} → ${to ? formatDateOnlyBR(to) : "—"}`;
  }
  if (field === "ownerUserId") {
    return `${rotulo}: ${nomeDoMembro(from, memberships)} → ${nomeDoMembro(to, memberships)}`;
  }
  // Empresa e descrição não cabem como "de → para": um é código interno,
  // o outro é texto longo.
  if (field === "companyId") return "Empresa do negócio alterada";
  if (field === "description") return "Descrição atualizada";
  return `${rotulo}: ${from ?? "—"} → ${to ?? "—"}`;
}

function descreve(activity: Activity, memberships: Membership[]): string {
  const payload = (activity.payload ?? {}) as Record<string, unknown>;

  if (activity.type === "stage_change") {
    const de = texto(payload, "fromStageName");
    const para = texto(payload, "toStageName");
    const base = de && para ? `Etapa: ${de} → ${para}` : "Mudou de etapa";
    // Tratamento do SLA escolhido ao voltar de Negociação (2026-09-16).
    const tratamento = texto(payload, "slaTratamento");
    if (tratamento === "erro_elaboracao") return `${base} (SLA: erro na elaboração, contagem mantida)`;
    if (tratamento === "alteracao_cliente") return `${base} (SLA: alteração pedida pelo cliente, contagem reiniciada)`;
    return base;
  }

  if (activity.type === "field_update") {
    const action = texto(payload, "action") ?? "";
    if (action === "created") return "Oportunidade criada";
    if (action === "deleted") return "Oportunidade excluída";
    if (action === "restored") return "Oportunidade restaurada";
    if (action === "status_changed") {
      const de = texto(payload, "from") ?? "";
      const para = texto(payload, "to") ?? "";
      const motivo = texto(payload, "lostReason");
      const base = `Situação: ${SITUACAO[de] ?? de} → ${SITUACAO[para] ?? para}`;
      return motivo ? `${base} (motivo: ${motivo})` : base;
    }
    if (action === "item_added") {
      const valor = texto(payload, "to");
      const item = texto(payload, "item") ?? "item";
      return valor ? `Item adicionado: ${item} — ${brl(valor)}` : `Item adicionado: ${item}`;
    }
    if (action === "item_removed") {
      return `Item removido: ${texto(payload, "item") ?? "item"}`;
    }
    if (action === "item_updated") {
      const item = texto(payload, "item") ?? "item";
      const anterior = texto(payload, "nomeAnterior");
      if (anterior) return `Item renomeado: ${anterior} → ${item}`;
      return `Item ${item}: ${brl(texto(payload, "from"))} → ${brl(texto(payload, "to"))}`;
    }
    if (action === "updated") {
      const changes = Array.isArray(payload.changes) ? payload.changes : [];
      if (changes.length === 0) return "Card editado";
      return changes
        .map((change) => descreveMudanca(change as Record<string, unknown>, memberships))
        .join(" · ");
    }
    return "Card editado";
  }

  // Registro manual da Timeline (anotação, ligação, e-mail…).
  const subtipo = texto(payload, "subtipo");
  const corpo = texto(payload, "texto");
  const rotulo = subtipo ? (SUBTIPO[subtipo] ?? subtipo) : "Registro";
  return corpo ? `${rotulo}: ${corpo}` : rotulo;
}

export default function HistoricoSection({
  opportunity,
  activities,
  memberships,
  carregando,
  erro,
}: {
  opportunity: OpportunityWithDetails;
  activities: Activity[] | null;
  memberships: Membership[];
  carregando: boolean;
  erro: string | null;
}) {
  const linhas = [...(activities ?? [])].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return (
    <div className="task-detail-section">
      <div className="drawer-section-title">Histórico do card</div>

      <div className="historico-resumo">
        <span>
          Aberta em <b>{formatDateBR(opportunity.createdAt)}</b>
        </span>
        <span>
          {opportunity.status === "open"
            ? "Em aberto"
            : `${SITUACAO[opportunity.status] ?? opportunity.status} em `}
          {opportunity.status !== "open" && opportunity.closedAt ? (
            <b>{formatDateBR(opportunity.closedAt)}</b>
          ) : null}
        </span>
        <span>
          Previsão de fechamento:{" "}
          <b>
            {opportunity.expectedCloseDate
              ? formatDateOnlyBR(opportunity.expectedCloseDate)
              : "—"}
          </b>
        </span>
      </div>

      {erro && <div className="error-banner">{erro}</div>}
      {carregando && <div className="chat-empty">Carregando o histórico…</div>}

      {!carregando && !erro && linhas.length === 0 && (
        <div className="chat-empty">Nenhuma movimentação registrada até agora.</div>
      )}

      {linhas.map((activity) => (
        <div key={activity.id} className="historico-item">
          <span className="historico-quando">{formatDateTimeBR(activity.occurredAt)}</span>
          <span className="historico-oque">{descreve(activity, memberships)}</span>
          <span className="historico-quem">{nomeDoMembro(activity.actorUserId, memberships)}</span>
        </div>
      ))}
    </div>
  );
}
