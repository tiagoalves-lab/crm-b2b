import Link from "next/link";
import type { Membership } from "@/lib/api/types";
import type { TaskDetail } from "./load";
import {
  completeTaskAction,
  createCommentAction,
  deleteAttachmentAction,
  deleteCommentAction,
  deleteTaskAction,
  downloadAttachmentAction,
  reopenTaskAction,
  uploadAttachmentAction,
} from "../actions";

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function fmtDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

function dueClass(task: TaskDetail["task"]): string {
  if (task.status === "done" || !task.dueAt) return "due-ok";
  const due = new Date(task.dueAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due < today) return "due-late";
  if (due.getTime() === today.getTime()) return "due-today";
  return "due-ok";
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
  const { task, attachments, targetLabel, me, memberships } = data;

  return (
    <>
      <div className="row-form" style={{ marginBottom: 6, flexWrap: "wrap" }}>
        <span className={task.status === "done" ? "pill pill-green" : "pill pill-gray"}>
          {task.status === "done" ? "Concluída" : "Pendente"}
        </span>
        <span className={`task-due ${dueClass(task)}`} style={{ fontFamily: "var(--font-mono)", fontSize: 12, marginLeft: "auto" }}>
          {fmtDate(task.dueAt)}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>{targetLabel}</div>
      {task.description && <p className="sub" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{task.description}</p>}

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
              <form action={downloadAttachmentAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="attachmentId" value={att.id} />
                <input type="hidden" name="back" value={backHref} />
                <button type="submit" className="icon-btn" title="Baixar">
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </button>
              </form>
              {att.uploadedBy === me.user.id && (
                <form action={deleteAttachmentAction}>
                  <input type="hidden" name="taskId" value={task.id} />
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
                  {c.authorUserId === me.user.id && (
                    <form action={deleteCommentAction}>
                      <input type="hidden" name="taskId" value={task.id} />
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
            <div className="chat-empty">Nenhum comentário ainda. Registre o andamento da tarefa.</div>
          )}
        </div>
        <form action={createCommentAction} className="chat-input-row">
          <input type="hidden" name="taskId" value={task.id} />
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

// Rodapé (protótipo: botões de renderTaskDetailModal).
export function DetailFooter({ data, backHref }: { data: TaskDetail; backHref: string }) {
  const { task } = data;
  const done = task.status === "done";

  return (
    <>
      <form action={deleteTaskAction}>
        <input type="hidden" name="id" value={task.id} />
        <button type="submit" className="btn btn-danger">
          Excluir
        </button>
      </form>
      <Link href="/dashboard/tarefas" className="btn btn-ghost">
        Fechar
      </Link>
      <Link href={`/dashboard/tarefas/${task.id}/editar`} className="btn">
        Editar dados
      </Link>
      <form action={done ? reopenTaskAction : completeTaskAction}>
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="back" value={backHref} />
        <button type="submit" className={done ? "btn" : "btn btn-primary"}>
          {done ? "Reabrir" : "Concluir"}
        </button>
      </form>
    </>
  );
}
