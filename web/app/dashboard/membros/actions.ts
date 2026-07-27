"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import { updateMembership } from "@/lib/api/memberships";
import type { MembershipRole, MembershipStatus } from "@/lib/api/types";

export async function updateMemberAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const role = formData.get("role");
  const status = formData.get("status");
  const managerIdRaw = formData.get("managerId");

  try {
    await updateMembership(token, id, {
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
}
