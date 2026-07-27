"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import { createContact, deleteContact, restoreContact } from "@/lib/api/contacts";

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

export async function createContactAction(formData: FormData) {
  const token = await getServerAccessToken();
  const name = String(formData.get("name") ?? "").trim();

  try {
    await createContact(token, {
      name,
      companyId: emptyToUndefined(formData.get("companyId")),
      email: emptyToUndefined(formData.get("email")),
      phone: emptyToUndefined(formData.get("phone")),
      title: emptyToUndefined(formData.get("title")),
    });
  } catch (error) {
    redirectWithError("/dashboard/contatos", error);
  }

  revalidatePath("/dashboard/contatos");
}

export async function deleteContactAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await deleteContact(token, id);
  } catch (error) {
    redirectWithError("/dashboard/contatos", error);
  }

  revalidatePath("/dashboard/contatos");
}

export async function restoreContactAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await restoreContact(token, id);
  } catch (error) {
    redirectWithError("/dashboard/contatos", error);
  }

  revalidatePath("/dashboard/contatos");
}
