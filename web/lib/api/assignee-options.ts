import { getMe } from "./me";
import { listMemberships } from "./memberships";

export interface AssigneeOption {
  userId: string;
  label: string;
}

// Responsável de uma tarefa nova: só o próprio representante (quem está
// criando) ou o gerente dele (pedido do usuário, 2026-08-04) — não a
// lista inteira de membros do workspace, que já existe no form de
// edição de uma tarefa existente (tarefas/_detail/detail-body.tsx).
// `membership` de GET /me não vem enriquecido com nome/login (só
// GET /memberships enriquece via Supabase Admin API), por isso só busca
// a lista inteira quando existe um gerente pra resolver.
export async function resolveAssigneeOptions(token: string): Promise<AssigneeOption[]> {
  const me = await getMe(token);
  const options: AssigneeOption[] = [
    { userId: me.user.id, label: me.user.name?.trim() || "Você" },
  ];

  if (me.membership.managerId) {
    const memberships = await listMemberships(token);
    const manager = memberships.find((m) => m.id === me.membership.managerId);
    if (manager) {
      const managerLabel =
        manager.name?.trim() || manager.login?.trim() || `${manager.userId.slice(0, 8)}…`;
      options.push({ userId: manager.userId, label: `${managerLabel} (gerente)` });
    }
  }

  return options;
}
