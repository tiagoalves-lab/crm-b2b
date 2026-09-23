"use server";

import { revalidatePath } from "next/cache";
import {
  redirectWithError,
  redirectWithMessage,
} from "@/lib/api/action-helpers";
import { getServerAccessToken } from "@/lib/api/auth";
import {
  enviarReportAgora,
  enviarReportTeste,
  saveReportConfig,
  type TipoReport,
} from "@/lib/api/reports";

const TELA = "/dashboard/e-mail-automatico";

const ROTULO: Record<TipoReport, string> = {
  "pipeline-diario": "Resumo diário",
  "pipeline-followup": "Follow-up de cotações",
  "lead-meta": "Aviso de lead novo",
};

function lerTipo(formData: FormData): TipoReport {
  const tipo = String(formData.get("tipo") ?? "");
  if (tipo === "pipeline-followup") return "pipeline-followup";
  if (tipo === "lead-meta") return "lead-meta";
  return "pipeline-diario";
}

// Os horários chegam como vários campos "horario" (um por linha do
// formulário, mais um vazio pra acrescentar). Campo em branco = linha
// removida — é assim que se apaga um horário sem JavaScript no cliente.
function lerHorarios(formData: FormData): string[] {
  return formData
    .getAll("horario")
    .map((h) => String(h).trim())
    .filter((h) => h.length > 0);
}

export async function salvarReportConfigAction(formData: FormData) {
  const token = await getServerAccessToken();
  const tipo = lerTipo(formData);

  try {
    await saveReportConfig(token, tipo, {
      ativo: formData.get("ativo") === "on",
      horarios: lerHorarios(formData),
      diasUteis: formData.get("diasUteis") === "on",
      etapas: formData.getAll("etapa").map((e) => String(e)),
    });
  } catch (error) {
    redirectWithError(TELA, error);
  }

  revalidatePath(TELA);
  redirectWithMessage(TELA, `${ROTULO[tipo]}: configuração salva`);
}

// Quem recebe ESTE relatório. Form separado do de horários de propósito:
// fica logo abaixo do envio de teste (pedido do usuário, 2026-09-15) e
// salva sozinho, sem exigir que a pessoa volte ao topo do card.
//
// Nenhuma caixinha marcada = todos os elegíveis, que é o padrão do
// sistema — a tela deixa isso explícito em vez de enviar para ninguém.
export async function salvarDestinatariosAction(formData: FormData) {
  const token = await getServerAccessToken();
  const tipo = lerTipo(formData);

  try {
    await saveReportConfig(token, tipo, {
      destinatarios: formData.getAll("destinatario").map((d) => String(d)),
    });
  } catch (error) {
    redirectWithError(TELA, error);
  }

  revalidatePath(TELA);
  redirectWithMessage(TELA, `${ROTULO[tipo]}: destinatários salvos`);
}

// Envio de teste pra quem está mexendo na tela — não registra nada e não
// consome o envio do dia.
export async function enviarTesteAction(formData: FormData) {
  const token = await getServerAccessToken();
  const tipo = lerTipo(formData);
  const para = String(formData.get("para") ?? "").trim();

  if (!para) {
    redirectWithError(
      TELA,
      new Error("Informe o e-mail para onde mandar o teste."),
    );
  }

  let resultado;
  try {
    resultado = await enviarReportTeste(token, tipo, para);
  } catch (error) {
    redirectWithError(TELA, error);
  }

  redirectWithMessage(
    TELA,
    resultado.status === "enviado"
      ? `Teste do ${ROTULO[tipo].toLowerCase()} enviado para ${para}`
      : `Não foi possível enviar: ${resultado.erro ?? resultado.status}`,
  );
}

// Envio real, para a lista toda, agora. Mesma esteira do agendado —
// inclusive a trava que impede repetir a mesma rodada.
export async function enviarAgoraAction(formData: FormData) {
  const token = await getServerAccessToken();
  const tipo = lerTipo(formData);

  let resultado;
  try {
    resultado = await enviarReportAgora(token, tipo);
  } catch (error) {
    redirectWithError(TELA, error);
  }

  revalidatePath(TELA);
  redirectWithMessage(TELA, mensagemDoEnvio(ROTULO[tipo], resultado));
}

function mensagemDoEnvio(
  rotulo: string,
  resultado: { status: string; destinatarios: number; erro?: string },
): string {
  switch (resultado.status) {
    case "enviado":
      return resultado.destinatarios > 0
        ? `${rotulo} enviado para ${resultado.destinatarios} destinatário(s)`
        : `${rotulo}: nada a enviar agora (nenhuma cotação nas etapas acompanhadas)`;
    case "ja-enviado":
      return `${rotulo}: esta rodada já tinha sido enviada hoje`;
    case "desligado":
      return `${rotulo}: envio de e-mail não configurado no servidor`;
    default:
      return `${rotulo}: falha — ${resultado.erro ?? "motivo não informado"}`;
  }
}
