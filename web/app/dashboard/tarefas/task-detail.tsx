import Link from "next/link";
import type { Company, Contact, Membership, Opportunity, TaskWithDetails } from "@/lib/api/types";
import {
  createChecklistItemAction,
  createCommentAction,
  deleteChecklistItemAction,
  deleteCommentAction,
  deleteTaskAction,
  toggleChecklistItemAction,
  updateTaskDetailAction,
} from "./actions";

function memberLabel(userId: string, members: Membership[], currentUserId: string): string {
  if (userId === currentUserId) return "Você";
  const known = members.find((m) => m.userId === userId);
  return known ? `${userId.slice(0, 8)}…` : userId.slice(0, 8) + "…";
}

function targetLabel(
  task: TaskWithDetails,
  companies: Company[],
  contacts: Contact[],
  opportunities: Opportunity[],
): string {
  if (task.companyId) {
    return `Empresa: ${companies.find((c) => c.id === task.companyId)?.name ?? "—"}`;
  }
  if (task.contactId) {
    return `Contato: ${contacts.find((c) => c.id === task.contactId)?.name ?? "—"}`;
  }
  if (task.opportunityId) {
    const opp = opportunities.find((o) => o.id === task.opportunityId);
    const company = opp ? companies.find((c) => c.id === opp.companyId) : null;
    return `Oportunidade: ${company?.name ?? "—"}`;
  }
  return "—";
}

export default function TaskDetail({
  task,
  backHref,
  companies,
  contacts,
  opportunities,
  members,
  currentUserId,
  error,
}: {
  task: TaskWithDetails;
  backHref: string;
  companies: Company[];
  contacts: Contact[];
  opportunities: Opportunity[];
  members: Membership[];
  currentUserId: string;
  error?: string;
}) {
  const checklistTotal = task.checklistItems.length;
  const checklistDone = task.checklistItems.filter((i) => i.done).length;

  return (
    <div className="content">
      <Link href={backHref} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← Voltar pro quadro
      </Link>

      {error && <div className="error-banner">{error}</div>}

      <div className="card-detail">
        <form action={updateTaskDetailAction} className="card-detail-form">
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="back" value={backHref} />
          <label>
            Título
            <input name="title" defaultValue={task.title} required />
          </label>
          <label>
            Descrição
            <textarea name="description" defaultValue={task.description ?? ""} rows={4} />
          </label>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label>
              Prazo
              <input
                name="dueAt"
                type="date"
                defaultValue={task.dueAt ? task.dueAt.slice(0, 10) : ""}
              />
            </label>
            <label>
              Responsável
              <select name="assigneeUserId" defaultValue={task.assigneeUserId}>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberLabel(m.userId, members, currentUserId)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            {targetLabel(task, companies, contacts, opportunities)}
          </p>
          <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>
            Salvar
          </button>
        </form>

        <div className="checklist-block">
          <h3>
            Checklist{" "}
            {checklistTotal > 0 && (
              <span className="count">
                {checklistDone}/{checklistTotal}
              </span>
            )}
          </h3>
          {task.checklistItems.map((item) => (
            <div key={item.id} className="checklist-item">
              <form action={toggleChecklistItemAction} className="checklist-item-form">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="done" value={String(item.done)} />
                <input type="hidden" name="back" value={backHref} />
                <button
                  type="submit"
                  className={item.done ? "check-toggle done" : "check-toggle"}
                  aria-label={item.done ? "Desmarcar" : "Marcar como feito"}
                >
                  {item.done ? "✓" : ""}
                </button>
              </form>
              <span className={item.done ? "checklist-text done" : "checklist-text"}>
                {item.text}
              </span>
              <form action={deleteChecklistItemAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="back" value={backHref} />
                <button type="submit" className="btn-ghost btn-sm" aria-label="Remover item">
                  ×
                </button>
              </form>
            </div>
          ))}
          <form action={createChecklistItemAction} className="row-form" style={{ marginTop: 8 }}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="back" value={backHref} />
            <input name="text" placeholder="Novo item" />
            <button type="submit" className="btn btn-sm">
              Adicionar
            </button>
          </form>
        </div>

        <div className="comments-block">
          <h3>Comentários</h3>
          {task.comments.map((comment) => (
            <div key={comment.id} className="comment">
              <div className="comment-head">
                <span className="comment-author">
                  {memberLabel(comment.authorUserId, members, currentUserId)}
                </span>
                <span className="comment-date">
                  {new Date(comment.createdAt).toLocaleString("pt-BR")}
                </span>
              </div>
              <p className="comment-body">{comment.body}</p>
              {comment.authorUserId === currentUserId && (
                <form action={deleteCommentAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="commentId" value={comment.id} />
                  <input type="hidden" name="back" value={backHref} />
                  <button type="submit" className="btn btn-ghost btn-sm">
                    Remover
                  </button>
                </form>
              )}
            </div>
          ))}
          {task.comments.length === 0 && (
            <p className="sub">Nenhum comentário ainda.</p>
          )}
          <form action={createCommentAction} className="row-form" style={{ marginTop: 8 }}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="back" value={backHref} />
            <input name="body" placeholder="Escreva um comentário" style={{ flex: 1 }} />
            <button type="submit" className="btn btn-sm">
              Comentar
            </button>
          </form>
        </div>

        <form action={deleteTaskAction} style={{ marginTop: 18 }}>
          <input type="hidden" name="id" value={task.id} />
          <button type="submit" className="btn btn-sm btn-danger">
            Excluir tarefa
          </button>
        </form>
      </div>
    </div>
  );
}
