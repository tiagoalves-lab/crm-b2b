import { apiFetch } from "./client";
import type { Membership, MembershipRole, MembershipStatus, PermissionMatrix } from "./types";

export function listMemberships(token: string): Promise<Membership[]> {
  return apiFetch<Membership[]>("/memberships", { token });
}

export interface CreateMembershipInput {
  name: string;
  login: string;
  // E-mail de contato — separado do login (que é o identificador de
  // acesso, texto livre, sem formato de e-mail exigido).
  email?: string;
  password: string;
  role?: MembershipRole;
  managerId?: string;
  // Subpágina de Permissões do modal — ausente = backend usa o preset
  // padrão do papel (ver DEFAULT_PERMISSIONS em permission-catalog.ts,
  // nos dois lados).
  permissions?: PermissionMatrix;
}

// Cria o login (Supabase Auth) e o Membership numa chamada só — o
// backend fala com a Admin API do Supabase usando a service role key,
// que nunca entra em web/ (docs/seguranca.md). Login é texto livre; a
// conversão pro formato exigido pelo Supabase Auth acontece só dentro
// do backend (SupabaseUserService) — web/ nunca lida com e-mail aqui.
export function createMembership(
  token: string,
  input: CreateMembershipInput,
): Promise<Membership> {
  return apiFetch<Membership>("/memberships", {
    method: "POST",
    token,
    body: input,
  });
}

export interface UpdateMembershipInput {
  name?: string;
  // E-mail de contato — mesmo campo de CreateMembershipInput.
  email?: string;
  // Muda o identificador de acesso (login) — ausente/undefined não mexe.
  login?: string;
  // Redefine a senha do login — ausente/undefined não mexe na atual.
  // Não existe "ver senha" (Supabase guarda só hash, ver comentário no
  // backend), isto é o equivalente prático.
  password?: string;
  role?: MembershipRole;
  status?: MembershipStatus;
  managerId?: string | null;
  // Mesmo campo de CreateMembershipInput — ausente = não mexe na matriz
  // já salva.
  permissions?: PermissionMatrix;
}

export function updateMembership(
  token: string,
  id: string,
  input: UpdateMembershipInput,
): Promise<Membership> {
  return apiFetch<Membership>(`/memberships/${id}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteMembership(token: string, id: string): Promise<Membership> {
  return apiFetch<Membership>(`/memberships/${id}`, {
    method: "DELETE",
    token,
  });
}
