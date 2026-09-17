"use client";

import type { OpportunityAttachment } from "@/lib/api/opportunity-attachments";
import {
  listOpportunityAttachmentsAction,
  prepareOpportunityAttachmentAction,
  removeOpportunityAttachmentClientAction,
} from "../actions";

// Envio de anexos do card de Oportunidade pelo NAVEGADOR (2026-09-17).
// Antes o arquivo subia dentro de uma Server Action, e a Vercel corta o
// corpo em 1 MB — PDF de proposta maior que isso derrubava o card com
// "An error occurred in the Server Components render". Agora:
//
// 1. a Server Action só registra o anexo e devolve a URL assinada
//    (requisição pequena, sem o arquivo);
// 2. o navegador faz o PUT direto no Storage do Supabase;
// 3. se o PUT falhar, o registro sem arquivo é apagado (melhor esforço).
//
// Um arquivo por vez; falha de um não impede os outros. Usado pelo card
// aberto (opportunity-detail.tsx) e pelo cadastro (nova/nova-card.tsx).
export async function enviarAnexosOportunidade(
  opportunityId: string,
  files: File[],
): Promise<{ lista: OpportunityAttachment[] | null; enviados: number; falhas: string[] }> {
  const falhas: string[] = [];
  let enviados = 0;

  for (const file of files) {
    const preparo = await prepareOpportunityAttachmentAction(opportunityId, {
      fileName: file.name,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    if (!preparo.ok) {
      falhas.push(`${file.name} (${preparo.message})`);
      continue;
    }
    try {
      const res = await fetch(preparo.data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      enviados += 1;
    } catch (error) {
      falhas.push(`${file.name} (${error instanceof Error ? error.message : "falha no envio"})`);
      await removeOpportunityAttachmentClientAction(opportunityId, preparo.data.attachmentId).catch(() => null);
    }
  }

  const listagem = await listOpportunityAttachmentsAction(opportunityId);
  return { lista: listagem.ok ? listagem.data : null, enviados, falhas };
}
