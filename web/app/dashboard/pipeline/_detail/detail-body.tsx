import Link from "next/link";
import { companyDisplayName } from "@/lib/api/companies";
import type { OpportunityDetail } from "./load";
import { deleteOpportunityAction, markWonAction, reopenAction } from "../actions";

function brlFull(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

// Corpo (protótipo: <dl class="kv"> de openDealDetail) — compartilhado
// entre a versão full-page e a versão modal do detalhe.
export function DetailKv({ data }: { data: OpportunityDetail }) {
  const { opportunity: o, company, stage } = data;
  const closed = o.status !== "open";

  return (
    <dl className="kv">
      <dt>Empresa</dt>
      <dd>{companyDisplayName(company)}</dd>
      <dt>Valor</dt>
      <dd style={{ fontFamily: "var(--font-mono)", color: "var(--accent-secondary)", fontWeight: 600 }}>
        {brlFull(Number(o.amount), o.currency)}
      </dd>
      <dt>Etapa</dt>
      <dd>
        {stage?.name ?? "—"}
        {closed ? "" : ` (${stage?.probability ?? 0}% prob.)`}
      </dd>
      {!closed && (
        <>
          <dt>Ponderado</dt>
          <dd style={{ fontFamily: "var(--font-mono)" }}>
            {brlFull(Math.round((Number(o.amount) * (stage?.probability ?? 0)) / 100), o.currency)}
          </dd>
        </>
      )}
      <dt>{closed ? "Encerrado em" : "Previsão"}</dt>
      <dd>{fmtDate(closed ? o.closedAt : o.expectedCloseDate)}</dd>
      {o.status === "lost" && o.lostReason && (
        <>
          <dt>Motivo perda</dt>
          <dd style={{ color: "var(--danger)" }}>{o.lostReason}</dd>
        </>
      )}
    </dl>
  );
}

// Rodapé (protótipo: botões de openDealDetail — Excluir/Fechar/Editar +
// Ganhar/Perder só no último estágio, Reabrir se já encerrada).
export function DetailFooter({ data }: { data: OpportunityDetail }) {
  const { opportunity: o, stage, maxOrder } = data;
  const closed = o.status !== "open";
  const canClose = o.status === "open" && stage && stage.order === maxOrder;

  return (
    <>
      <form action={deleteOpportunityAction}>
        <input type="hidden" name="id" value={o.id} />
        <button type="submit" className="btn btn-danger">
          Excluir
        </button>
      </form>
      <Link href="/dashboard/pipeline" className="btn btn-ghost">
        Fechar
      </Link>
      {!closed && (
        <Link href={`/dashboard/pipeline/${o.id}/editar`} className="btn">
          Editar
        </Link>
      )}
      {canClose && (
        <>
          <form action={markWonAction}>
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="version" value={o.version} />
            <button type="submit" className="btn" style={{ borderColor: "var(--blue)", color: "var(--blue)" }}>
              ✓ Marcar Fechada
            </button>
          </form>
          <Link href={`/dashboard/pipeline/${o.id}/perder`} className="btn btn-danger">
            ✕ Marcar Perdida
          </Link>
        </>
      )}
      {closed && (
        <form action={reopenAction}>
          <input type="hidden" name="id" value={o.id} />
          <input type="hidden" name="version" value={o.version} />
          <input type="hidden" name="back" value={`/dashboard/pipeline/${o.id}`} />
          <button type="submit" className="btn">
            ↩ Reabrir
          </button>
        </form>
      )}
    </>
  );
}
