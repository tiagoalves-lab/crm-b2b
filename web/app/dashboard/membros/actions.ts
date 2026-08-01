"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { createMembership, deleteMembership, updateMembership } from "@/lib/api/memberships";
import type { MembershipRole, MembershipStatus } from "@/lib/api/types";

// Redireciona pra /dashboard/membros (fora da rota interceptada
// /dashboard/membros/novo) tanto no sucesso quanto no erro — mesmo padrão
// de createCompanyAction (empresas/actions.ts): sem client JS, o
// redirect() é o que fecha o modal (a navegação sai da rota interceptada).
export async function createMemberAction(formData: FormData) {
  const token = await getServerAccessToken();
  const name = String(formData.get("name") ?? "").trim();
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = formData.get("role");
  const managerIdRaw = formData.get("managerId");

  try {
    await createMembership(token, {
      name,
      login,
      password,
      role: role ? (String(role) as MembershipRole) : undefined,
      managerId: managerIdRaw ? String(managerIdRaw) : undefined,
    });
  } catch (error) {
    redirectWithError("/dashboard/membros", error);
  }

  revalidatePath("/dashboard/membros");
  redirectWithMessage("/dashboard/membros", "Membro criado");
}

export async function updateMemberAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const name = formData.get("name");
  const password = String(formData.get("password") ?? "").trim();
  const role = formData.get("role");
  const status = formData.get("status");
  const managerIdRaw = formData.get("managerId");

  try {
    await updateMembership(token, id, {
      name: name ? String(name).trim() : undefined,
      password: password ? password : undefined,
      role: role ? (String(role) as MembershipRole) : undefined,
      status: status ? (String(status) as MembershipStatus) : undefined,
      managerId:
        managerIdRaw === ""
          ? null
          : managerIdRaw
            ? String(managerIdRaw)
            : undefined,
    });
  } catch (error) {
    redirectWithError("/dashboard/membros", error);
  }

  revalidatePath("/dashboard/membros");
  redirectWithMessage("/dashboard/membros", "Membro atualizado");
}

export async function removeMemberAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await deleteMembership(token, id);
  } catch (error) {
    redirectWithError("/dashboard/membros", error);
  }

  revalidatePath("/dashboard/membros");
  redirectWithMessage("/dashboard/membros", "Membro removido");
}
