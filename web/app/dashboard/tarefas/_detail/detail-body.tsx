import Link from "next/link";
import type { Membership } from "@/lib/api/types";
import { formatDateTimeBR } from "@/lib/format-date";
import type { TaskDetail } from "./load";
import TipoContatoFields from "../tipo-contato-fields";
import {
  completeTaskAction,
  createCommentAction,
  deleteAttachmentAction,
  deleteCommentAction,
  deleteTaskAction,
  downloadAttachmentAction,
  reopenTaskAction,
  updateTaskDetailAction,
  uploadAttachmentAction,
} from "../actions";
import SubmitButton, { ExternalSubmitButton } from "@/app/_components/submit-button";

// Único form de edição da tarefa (título/descrição/tipo/prazo/
// responsável) — o botão "Salvar" mora no rodapé do modal (DetailFooter,
// fora da árvore deste <form>), por isso o atributo form= referenciando
// esse id (associação padrão do HTML, funciona com Server Actions do
// Next igual a qualquer outro submit).
const EDIT_FORM_ID = "task-edit-form";

function fmtDateTime(value: string): string {
  return formatDateTimeBR(value);
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

// Corpo (protótipo: openTaskDetail/renderTaskDetailModal) — pill de
// status + vínculo + anexos (drop-zone real, upload via signed URL do
// Supabase Storage) + chat de comentários. Sem checklist (SPEC-CRM-GAMA.md
// não pede; feature extra da v1 removida da UI a pedido do usuário — o
// endpoint no backend continua existindo, só não é exposto aqui).
export function DetailBody({ data, backHref }: { data: TaskDetail; backHref: string }) {
  const { task, attachments, targetLabel, me, memberships, contacts, companyId } = data;

  return (
    <>
      <div
        className="row-form"
        style={{ marginBottom: 12, justifyContent: "space-between", alignItems: "center" }}
      >
        <div className="row-form" style={{ alignItems: "center", gap: 10 }}>
          <span className={task.status === "done" ? "pill pill-green" : "pill pill-gray"}>
            {task.status === "done" ? "Concluída" : "Pendente"}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{targetLabel}</span>
        </div>
        <span className="field-hint" style={{ marginTop: 0 }}>
          Inserido por {memberDisplayName(task.createdBy, memberships)}
        </span>
      </div>

      <form id={EDIT_FORM_ID} action={updateTaskDetailAction} className="form-grid">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="back" value={backHref} />
        <label style={{ gridColumn: "1 / -1" }}>
          Título
          <input name="title" defaultValue={task.title} required />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Descrição
          <textarea name="description" defaultValue={task.description ?? ""} rows={3} />
        </label>
        <TipoContatoFields
          initialTipo={task.tipo}
          contactId={task.contactId}
          contacts={contacts}
          companyId={companyId}
        />
        <label>
          Prazo
          <input
            name="dueAt"
            type="date"
            defaultValue={task.dueAt ? task.dueAt.slice(0, 10) : ""}
            required
          />
        </label>
        <label>
          Responsável
          <select name="assigneeUserId" defaultValue={task.assigneeUserId} required>
            {memberships.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberDisplayName(m.userId, memberships)}
              </option>
            ))}
          </select>
        </label>
      </form>

      <div className="task-detail-section">
        <div className="drawer-section-title" style={{ marginTop: 0 }}>
          Anexos{attachments.length > 0 ? ` · ${attachments.length}` : ""}
        </div>
        <form action={uploadAttachmentAction} encType="multipart/form-data" className="attach-drop" style={{ cursor: "default" }}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="back" value={backHref} />
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <div className="attach-drop-text" style={{ marginBottom: 10 }}>
            Anexar um arquivo (foto, PDF, planilha)
          </div>
          <div className="row-form" style={{ justifyContent: "center" }}>
            <input type="file" name="file" required />
            <SubmitButton className="btn btn-sm" pendingLabel="Enviando…">
              Enviar
            </SubmitButton>
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
              <form action={downloadAttachmentAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="attachmentId" value={att.id} />
                <input type="hidden" name="back" value={backHref} />
                <SubmitButton className="icon-btn" title="Baixar">
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </SubmitButton>
              </form>
              {att.uploadedBy === me.user.id && me.membership.role !== "sales_rep" && (
                <form action={deleteAttachmentAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="attachmentId" value={att.id} />
                  <input type="hidden" name="back" value={backHref} />
                  <SubmitButton className="icon-btn danger" title="Remover">
                    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </SubmitButton>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <div className="task-detail-section">
        <div className="drawer-section-title">Comentários{task.comments.length > 0 ? ` · ${task.comments.length}` : ""}</div>
        <div className="chat-thread">
          {task.comments.length > 0 ? (
            task.comments.map((c) => {
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
                  {c.authorUserId === me.user.id && me.membership.role !== "sales_rep" && (
                    <form action={deleteCommentAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="commentId" value={c.id} />
                      <input type="hidden" name="back" value={backHref} />
                      <SubmitButton
                        className="btn btn-ghost btn-sm"
                        style={{ padding: 0, marginTop: 4 }}
                        pendingLabel="Removendo…"
                      >
                        Remover
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>
              );
            })
          ) : (
            <div className="chat-empty">Nenhum comentário ainda. Registre o andamento da tarefa.</div>
          )}
        </div>
        <form action={createCommentAction} className="chat-input-row">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="back" value={backHref} />
          <textarea name="body" placeholder="Escrever comentário..." required />
          <SubmitButton className="btn btn-primary btn-sm" pendingLabel="Enviando…">
            Enviar
          </SubmitButton>
        </form>
      </div>
    </>
  );
}

// Rodapé (protótipo: botões de renderTaskDetailModal).
export function DetailFooter({ data, backHref }: { data: TaskDetail; backHref: string }) {
  const { task, me } = data;
  const done = task.status === "done";
  // Representante não exclui nenhum tipo de registro (pedido do usuário,
  // 2026-08-06, ver PolicyService#can) — botão escondido pra não oferecer
  // uma ação que o backend vai rejeitar de qualquer forma.
  const canDelete = me.membership.role !== "sales_rep";

  return (
    <>
      {canDelete && (
        <form action={deleteTaskAction}>
          <input type="hidden" name="id" value={task.id} />
          <SubmitButton className="btn btn-danger" pendingLabel="Excluindo…">
            Excluir
          </SubmitButton>
        </form>
      )}
      <Link href="/dashboard/tarefas" className="btn btn-ghost">
        Fechar
      </Link>
      <ExternalSubmitButton form={EDIT_FORM_ID} className="btn" pendingLabel="Salvando…">
        Salvar
      </ExternalSubmitButton>
      <form action={done ? reopenTaskAction : completeTaskAction}>
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="back" value={backHref} />
        <SubmitButton
          className={done ? "btn" : "btn btn-primary"}
          pendingLabel={done ? "Reabrindo…" : "Concluindo…"}
        >
          {done ? "Reabrir" : "Concluir"}
        </SubmitButton>
      </form>
    </>
  );
}
