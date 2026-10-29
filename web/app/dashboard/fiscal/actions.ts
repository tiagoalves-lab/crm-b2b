"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/api/action-helpers";
import { getServerAccessToken } from "@/lib/api/auth";
import {
  classificarEntrada,
  desvincularRetorno,
  iniciarCargaEmitidas,
  reabrirAlerta,
  tratarAlerta,
  vincularRetorno,
  type AlertaRemessa,
  type ClassificacaoEntrada,
  type VinculoRemessa,
} from "@/lib/api/fiscal";

// Dispara a atualização das notas emitidas e volta na hora — a carga roda
// em segundo plano no backend; a tela mostra o andamento ao recarregar.
export async function atualizarNotasAction(): Promise<void> {
  try {
    const token = await getServerAccessToken();
    await iniciarCargaEmitidas(token);
  } catch (error) {
    console.error(`[fiscal] atualizar notas: ${errorMessage(error)}`);
  }
  revalidatePath("/dashboard/fiscal");
}

// Arrastar o retorno pra remessa / desfazer (decisão 7.5). Devolve o erro
// em texto pra tela mostrar na hora, sem sair da página.
export async function vincularRetornoAction(vinculo: VinculoRemessa): Promise<{ erro: string | null }> {
  return decidir(vinculo, vincularRetorno);
}

export async function desvincularRetornoAction(vinculo: VinculoRemessa): Promise<{ erro: string | null }> {
  return decidir(vinculo, desvincularRetorno);
}

async function decidir(
  vinculo: VinculoRemessa,
  chamada: (token: string, vinculo: VinculoRemessa) => Promise<unknown>,
): Promise<{ erro: string | null }> {
  // Fora do try: sessão vencida manda pro login em vez de virar mensagem.
  const token = await getServerAccessToken();
  try {
    await chamada(token, vinculo);
  } catch (error) {
    return { erro: errorMessage(error) };
  }
  revalidatePath("/dashboard/fiscal");
  return { erro: null };
}

// Marcar um alerta do Controle de remessas como tratado / reabrir
// (decisão 7.7). Mesmo molde do vínculo: o erro volta em texto pra tela.
export async function tratarAlertaAction(alerta: AlertaRemessa): Promise<{ erro: string | null }> {
  return registrarAlerta(alerta, tratarAlerta);
}

export async function reabrirAlertaAction(alerta: AlertaRemessa): Promise<{ erro: string | null }> {
  return registrarAlerta(alerta, reabrirAlerta);
}

async function registrarAlerta(
  alerta: AlertaRemessa,
  chamada: (token: string, alerta: AlertaRemessa) => Promise<unknown>,
): Promise<{ erro: string | null }> {
  const token = await getServerAccessToken();
  try {
    await chamada(token, alerta);
  } catch (error) {
    return { erro: errorMessage(error) };
  }
  revalidatePath("/dashboard/fiscal");
  return { erro: null };
}

// Classificação dos itens de uma nota de entrada (decisão 7.8). Mesmo
// molde: o erro volta em texto pra tela.
export async function classificarEntradaAction(dados: ClassificacaoEntrada): Promise<{ erro: string | null }> {
  const token = await getServerAccessToken();
  try {
    await classificarEntrada(token, dados);
  } catch (error) {
    return { erro: errorMessage(error) };
  }
  revalidatePath("/dashboard/fiscal");
  return { erro: null };
}
