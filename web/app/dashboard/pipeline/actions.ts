"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import { createOpportunity, updateOpportunity } from "@/lib/api/opportunities";
import { createPipeline, createStage } from "@/lib/api/pipelines";

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

export async function createPipelineAction(formData: FormData) {
  const token = await getServerAccessToken();
  const name = String(formData.get("name") ?? "").trim();

  try {
    await createPipeline(token, { name, isDefault: true });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}

export async function createStageAction(formData: FormData) {
  const token = await getServerAccessToken();
  const pipelineId = String(formData.get("pipelineId"));
  const name = String(formData.get("name") ?? "").trim();
  const order = Number(formData.get("order") ?? 0);
  const probability = Number(formData.get("probability") ?? 0);

  try {
    await createStage(token, pipelineId, { name, order, probability });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}

export async function createOpportunityAction(formData: FormData) {
  const token = await getServerAccessToken();

  try {
    await createOpportunity(token, {
      companyId: String(formData.get("companyId")),
      pipelineId: String(formData.get("pipelineId")),
      stageId: String(formData.get("stageId")),
      amount: Number(formData.get("amount")),
      currency: String(formData.get("currency") ?? "BRL").toUpperCase(),
      expectedCloseDate: emptyToUndefined(formData.get("expectedCloseDate")),
    });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}

export async function moveStageAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));
  const stageId = String(formData.get("stageId"));

  try {
    await updateOpportunity(token, id, { version, stageId });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}

export async function markWonAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));

  try {
    await updateOpportunity(token, id, { version, status: "won" });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}

export async function markLostAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));
  const lostReason = String(formData.get("lostReason") ?? "").trim();

  try {
    await updateOpportunity(token, id, {
      version,
      status: "lost",
      lostReason: lostReason || "Não informado",
    });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}

export async function reopenAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));

  try {
    await updateOpportunity(token, id, { version, status: "open" });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}
