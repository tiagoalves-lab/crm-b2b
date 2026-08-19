"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { errorMessage, redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { createMembership, deleteMembership, updateMembership } from "@/lib/api/memberships";
import type { MembershipRole, MembershipStatus, PermissionMatrix } from "@/lib/api/types";

// Campo hidden preenchido por PermissionsEditor (JSON.stringify do estado
// React) — parse defensivo: JSON malformado (não deveria acontecer, vem
// do próprio componente) cai pra undefined em vez de derrubar a Server
// Action inteira, deixando o backend aplicar o preset padrão do papel.
function parsePermissionsField(formData: FormData): PermissionMatrix | undefined {
  const raw = formData.get("permissions");
  if (!raw) return undefined;
  try {
    return JSON.parse(String(raw)) as PermissionMatrix;
  } catch {
    return undefined;
  }
}

export type CreateMemberState = { ok: true } | { ok: false; message: string };

// Devolve o resultado em vez de redirecionar no sucesso — usado via
// useActionState (member-form.tsx) pro modal fechar com router.push no
// client depois de confirmar. redirect() de dentro da Server Action não
// derruba o slot @modal da rota interceptada (mesmo motivo documentado em
// createCompanyAction, empresas/actions.ts) — o modal ficava aberto com o
// membro já criado.
export async function createMemberAction(
  _prevState: CreateMemberState | null,
  formData: FormData,
): Promise<CreateMemberState> {
  const token = await getServerAccessToken();
  const name = String(formData.get("name") ?? "").trim();
  const login = String(formData.get("login") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = formData.get("role");
  const managerIdRaw = formData.get("managerId");

  try {
    await createMembership(token, {
      name,
      login,
      email: email ? email : undefined,
      password,
      role: role ? (String(role) as MembershipRole) : undefined,
      managerId: managerIdRaw ? String(managerIdRaw) : undefined,
      permissions: parsePermissionsField(formData),
    });
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  revalidatePath("/dashboard/membros");
  return { ok: true };
}

export async function updateMemberAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const name = formData.get("name");
  const login = String(formData.get("login") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const role = formData.get("role");
  const status = formData.get("status");
  const managerIdRaw = formData.get("managerId");

  try {
    await updateMembership(token, id, {
      name: name ? String(name).trim() : undefined,
      // Limitação aceita (mesmo padrão já documentado pra outros campos
      // opcionais do projeto): campo vazio vira "não mexer", não dá pra
      // limpar um e-mail já salvo de volta pra vazio por este form.
      email: email ? email : undefined,
      // Login é obrigatório no form (sempre vem preenchido, igual name) —
      // muda o identificador de acesso no Supabase Auth via
      // SupabaseUserService#updateUserLogin.
      login: login ? login : undefined,
      password: password ? password : undefined,
      role: role ? (String(role) as MembershipRole) : undefined,
      status: status ? (String(status) as MembershipStatus) : undefined,
      managerId:
        managerIdRaw === ""
          ? null
          : managerIdRaw
            ? String(managerIdRaw)
            : undefined,
      permissions: parsePermissionsField(formData),
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
