import { getMe } from "./me";
import { listMemberships } from "./memberships";

export interface AssigneeOption {
  userId: string;
  label: string;
}

// Responsável de uma tarefa nova: qualquer membro ativo do workspace
// (pedido do usuário, 2026-10-29 — antes era só quem cria ou o gerente
// dele). Quem está criando vem primeiro, já selecionado; o backend
// confere se o escolhido é membro ativo (assertActiveMembership).
export async function resolveAssigneeOptions(token: string): Promise<AssigneeOption[]> {
  const [me, memberships] = await Promise.all([getMe(token), listMemberships(token)]);
  const options: AssigneeOption[] = [
    { userId: me.user.id, label: me.user.name?.trim() || "Você" },
  ];

  const outros = memberships
    .filter((m) => m.status === "active" && m.userId !== me.user.id)
    .map((m) => {
      const nome = m.name?.trim() || m.login?.trim() || `${m.userId.slice(0, 8)}…`;
      return {
        userId: m.userId,
        label: m.id === me.membership.managerId ? `${nome} (gerente)` : nome,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return [...options, ...outros];
}
