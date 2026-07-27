"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import { createTask, deleteTask, updateTask } from "@/lib/api/tasks";

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

export async function createTaskAction(formData: FormData) {
  const token = await getServerAccessToken();

  try {
    await createTask(token, {
      title: String(formData.get("title") ?? "").trim(),
      dueAt: emptyToUndefined(formData.get("dueAt")),
      companyId: emptyToUndefined(formData.get("companyId")),
      contactId: emptyToUndefined(formData.get("contactId")),
      opportunityId: emptyToUndefined(formData.get("opportunityId")),
    });
  } catch (error) {
    redirectWithError("/dashboard/tarefas", error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function completeTaskAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await updateTask(token, id, { status: "done" });
  } catch (error) {
    redirectWithError("/dashboard/tarefas", error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function reopenTaskAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await updateTask(token, id, { status: "pending" });
  } catch (error) {
    redirectWithError("/dashboard/tarefas", error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function deleteTaskAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await deleteTask(token, id);
  } catch (error) {
    redirectWithError("/dashboard/tarefas", error);
  }

  revalidatePath("/dashboard/tarefas");
}
