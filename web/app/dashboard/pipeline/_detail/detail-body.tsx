import Link from "next/link";
import { companyDisplayName } from "@/lib/api/companies";
import type { Membership } from "@/lib/api/types";
import type { OpportunityDetail } from "./load";
import {
  createOpportunityCommentAction,
  deleteOpportunityAction,
  deleteOpportunityAttachmentAction,
  deleteOpportunityCommentAction,
  downloadOpportunityAttachmentAction,
  markWonAction,
  reopenAction,
  uploadOpportunityAttachmentAction,
} from "../actions";

function brlFull(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function fmtDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

function attachKind(mimeType: string | null): "pdf" | "imagem" | "planilha" | "outro" {
  if (!mimeType) return "outro";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "imagem";
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType === "text/csv") return "planilha";
  return "outro";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Nome de exibição do autor do comentário — sempre o nome/login real do
// membro (GET /memberships vem enriquecido a partir do Supabase Auth, ver
// membros/roles.ts#memberName), nunca "Você" mesmo pro autor ser o
// usuário logado.
function memberDisplayName(userId: string, memberships: Membership[]): string {
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || `${userId.slice(0, 8)}…`;
}

function initialsOf(name: string): string {
  return name.slice(0, 2).toUpperCase();
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

// Anexos + chat de comentários do card (feature nova, fora do
// SPEC-CRM-GAMA.md original, estilo Trello) — cópia direta da seção
// equivalente em tarefas/_detail/detail-body.tsx, trocando task/taskId
// por opportunity/opportunityId.
export function DetailBody({ data, backHref }: { data: OpportunityDetail; backHref: string }) {
  const { opportunity: o, attachments, me, memberships } = data;

  return (
    <>
      <DetailKv data={data} />

      <div className="task-detail-section">
        <div className="drawer-section-title" style={{ marginTop: 0 }}>
          Anexos{attachments.length > 0 ? ` · ${attachments.length}` : ""}
        </div>
        <form action={uploadOpportunityAttachmentAction} encType="multipart/form-data" className="attach-drop" style={{ cursor: "default" }}>
          <input type="hidden" name="opportunityId" value={o.id} />
          <input type="hidden" name="back" value={backHref} />
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <div className="attach-drop-text" style={{ marginBottom: 10 }}>
            Anexar um arquivo (foto, PDF, planilha)
          </div>
          <div className="row-form" style={{ justifyContent: "center" }}>
            <input type="file" name="file" required />
            <button type="submit" className="btn btn-sm">
              Enviar
            </button>
          </div>
        </form>
        {attachments.map((att) => {
          const kind = attachKind(att.mimeType);
          return (
            <div key={att.id} className="attach-item">
              <div className={`attach-icon ${kind}`}>
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              </div>
              <div className="attach-info">
                <div className="attach-name">{att.fileName}</div>
                <div className="attach-meta">
                  {kind.toUpperCase()} · {formatBytes(att.sizeBytes)}
                </div>
              </div>
              <form action={downloadOpportunityAttachmentAction}>
                <input type="hidden" name="opportunityId" value={o.id} />
                <input type="hidden" name="attachmentId" value={att.id} />
                <input type="hidden" name="back" value={backHref} />
                <button type="submit" className="icon-btn" title="Baixar">
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </button>
              </form>
              {att.uploadedBy === me.user.id && (
                <form action={deleteOpportunityAttachmentAction}>
                  <input type="hidden" name="opportunityId" value={o.id} />
                  <input type="hidden" name="attachmentId" value={att.id} />
                  <input type="hidden" name="back" value={backHref} />
                  <button type="submit" className="icon-btn danger" title="Remover">
                    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <div className="task-detail-section">
        <div className="drawer-section-title">Comentários{o.comments.length > 0 ? ` · ${o.comments.length}` : ""}</div>
        <div className="chat-thread">
          {o.comments.length > 0 ? (
            o.comments.map((c) => {
              const authorName = memberDisplayName(c.authorUserId, memberships);
              return (
              <div key={c.id} className="chat-msg">
                <div className="chat-avatar">{initialsOf(authorName)}</div>
                <div className="chat-bubble">
                  <div className="chat-msg-head">
                    <span className="chat-author">{authorName}</span>
                    <span className="chat-time">{fmtDateTime(c.createdAt)}</span>
                  </div>
                  <div className="chat-text">{c.body}</div>
                  {c.authorUserId === me.user.id && (
                    <form action={deleteOpportunityCommentAction}>
                      <input type="hidden" name="opportunityId" value={o.id} />
                      <input type="hidden" name="commentId" value={c.id} />
                      <input type="hidden" name="back" value={backHref} />
                      <button type="submit" className="btn btn-ghost btn-sm" style={{ padding: 0, marginTop: 4 }}>
                        Remover
                      </button>
                    </form>
                  )}
                </div>
              </div>
              );
            })
          ) : (
            <div className="chat-empty">Nenhum comentário ainda. Registre o andamento da negociação.</div>
          )}
        </div>
        <form action={createOpportunityCommentAction} className="chat-input-row">
          <input type="hidden" name="opportunityId" value={o.id} />
          <input type="hidden" name="back" value={backHref} />
          <textarea name="body" placeholder="Escrever comentário..." required />
          <button type="submit" className="btn btn-primary btn-sm">
            Enviar
          </button>
        </form>
      </div>
    </>
  );
}

// Rodapé (protótipo: botões de openDealDetail — Excluir/Fechar/Editar +
// Ganhar/Perder só no último estágio, Reabrir se já encerrada). Ganhou
// "Gerar tarefa" (feature nova) ao lado de "Editar".
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
      {!closed && (
        <Link href={`/dashboard/pipeline/${o.id}/nova-tarefa`} className="btn">
          + Gerar tarefa
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
