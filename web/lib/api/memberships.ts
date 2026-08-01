import { apiFetch } from "./client";
import type { Membership, MembershipRole, MembershipStatus } from "./types";

export function listMemberships(token: string): Promise<Membership[]> {
  return apiFetch<Membership[]>("/memberships", { token });
}

export interface CreateMembershipInput {
  email: string;
  password: string;
  role?: MembershipRole;
  managerId?: string;
}

// Cria o login (Supabase Auth) e o Membership numa chamada só — o
// backend fala com a Admin API do Supabase usando a service role key,
// que nunca entra em web/ (docs/seguranca.md).
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
