"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/api/action-helpers";
import { getServerAccessToken } from "@/lib/api/auth";
import { criarDispositivo, revogarDispositivo } from "@/lib/api/telefonia";

const PAGINA = "/dashboard/telefonia";

export type CredencialResult =
  | { ok: true; nome: string; token: string }
  | { ok: false; message: string };

// O token em claro volta UMA vez e fica na tela até o usuário sair dela —
// nunca é gravado em lugar nenhum do CRM (só o hash). Perdeu, gera outro.
export async function gerarCredencialAction(
  nome: string,
  userId?: string,
): Promise<CredencialResult> {
  try {
    const token = await getServerAccessToken();
    const res = await criarDispositivo(token, {
      nome: nome.trim(),
      userId: userId || undefined,
    });
    revalidatePath(PAGINA);
    return { ok: true, nome: res.dispositivo.nome, token: res.token };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function revogarCredencialAction(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const token = await getServerAccessToken();
    await revogarDispositivo(token, id);
    revalidatePath(PAGINA);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}
