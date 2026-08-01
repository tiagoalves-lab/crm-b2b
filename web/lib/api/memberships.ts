import { apiFetch } from "./client";
import type { Membership, MembershipRole, MembershipStatus } from "./types";

export function listMemberships(token: string): Promise<Membership[]> {
  return apiFetch<Membership[]>("/memberships", { token });
}

export interface CreateMembershipInput {
  name: string;
  login: string;
  password: string;
  role?: MembershipRole;
  managerId?: string;
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
  // Redefine a senha do login — ausente/undefined não mexe na atual.
  // Não existe "ver senha" (Supabase guarda só hash, ver comentário no
  // backend), isto é o equivalente prático.
  password?: string;
  role?: MembershipRole;
  status?: MembershipStatus;
  managerId?: string | null;
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
