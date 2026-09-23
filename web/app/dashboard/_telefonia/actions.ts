"use server";

import { errorMessage } from "@/lib/api/action-helpers";
import { getServerAccessToken } from "@/lib/api/auth";
import {
  atualizarChamada,
  iniciarChamada,
  type IniciarChamadaInput,
} from "@/lib/api/telefonia";

// RPC (sem redirect), igual ao padrão das ações de ficha: o botão de
// ligar vive dentro de drawer/modal, e action de modal nunca redireciona
// (regra do projeto, ver _overlay/refresh.ts).

export type LigarResult =
  | { ok: true; chamadaId: string; discarUri: string }
  | { ok: false; message: string };

export async function ligarAction(
  input: IniciarChamadaInput,
): Promise<LigarResult> {
  try {
    const token = await getServerAccessToken();
    const chamada = await iniciarChamada(token, input);
    return { ok: true, chamadaId: chamada.id, discarUri: chamada.discarUri };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export type RegistroResult = { ok: true } | { ok: false; message: string };

export async function registrarChamadaAction(
  chamadaId: string,
  input: { observacao?: string; resultado?: "atendida" | "nao_atendida" },
): Promise<RegistroResult> {
  try {
    const token = await getServerAccessToken();
    await atualizarChamada(token, chamadaId, input);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}
