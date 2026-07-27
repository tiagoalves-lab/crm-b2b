import { apiFetch } from "./client";
import type { Membership, MembershipRole, MembershipStatus } from "./types";

export function listMemberships(token: string): Promise<Membership[]> {
  return apiFetch<Membership[]>("/memberships", { token });
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
