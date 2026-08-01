import type { TaskDetail } from "../../_detail/load";
import { updateTaskDetailAction } from "../../actions";

function memberLabel(userId: string, currentUserId: string): string {
  return userId === currentUserId ? "Você" : `${userId.slice(0, 8)}…`;
}

// Compartilhado entre a versão full-page e a versão modal de "Editar
// tarefa" (protótipo: openTaskForm). Vínculo (empresa/oportunidade) não é
// editável aqui — mesma limitação que o app já tinha antes (UpdateTaskDto
// não aceita trocar companyId/opportunityId).
export default function EditForm({ data, backHref }: { data: TaskDetail; backHref: string }) {
  const { task, memberships, me, targetLabel } = data;

  return (
    <form action={updateTaskDetailAction} className="form-grid">
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
      <label>
        Prazo
        <input name="dueAt" type="date" defaultValue={task.dueAt ? task.dueAt.slice(0, 10) : ""} />
      </label>
      <label>
        Responsável
        <select name="assigneeUserId" defaultValue={task.assigneeUserId}>
          {memberships.map((m) => (
            <option key={m.userId} value={m.userId}>
              {memberLabel(m.userId, me.user.id)}
            </option>
          ))}
        </select>
      </label>
      <div style={{ gridColumn: "1 / -1" }} className="field-hint">
        {targetLabel}
      </div>
      <button type="submit" className="btn btn-primary">
        Salvar
      </button>
    </form>
  );
}
