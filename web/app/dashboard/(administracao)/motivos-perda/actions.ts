"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { errorMessage } from "@/lib/api/action-helpers";
import { createLostReason, deleteLostReason, renameLostReason } from "@/lib/api/opportunity-lost-reasons";

type Result = { ok: true } | { ok: false; message: string };

// Aba "Motivos de perda" (Administração, 2026-09-17). Página comum (não
// modal), então revalidatePath é seguro aqui.
async function executar(fn: (token: string) => Promise<unknown>): Promise<Result> {
  const token = await getServerAccessToken();
  try {
    await fn(token);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
  revalidatePath("/dashboard/motivos-perda");
  return { ok: true };
}

export async function criarMotivoAction(nome: string): Promise<Result> {
  const texto = String(nome ?? "").trim();
  if (!texto) return { ok: false, message: "Digite o motivo." };
  return executar((token) => createLostReason(token, texto));
}

export async function renomearMotivoAction(id: string, nome: string): Promise<Result> {
  const texto = String(nome ?? "").trim();
  if (!texto) return { ok: false, message: "Digite o motivo." };
  return executar((token) => renameLostReason(token, String(id), texto));
}

export async function excluirMotivoAction(id: string): Promise<Result> {
  return executar((token) => deleteLostReason(token, String(id)));
}
