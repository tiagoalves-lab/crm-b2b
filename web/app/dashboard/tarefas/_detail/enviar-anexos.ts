"use client";

import type { TaskAttachment } from "@/lib/api/task-attachments";
import {
  listTaskAttachmentsAction,
  prepareTaskAttachmentAction,
  removeTaskAttachmentAction,
} from "../actions";

// Envio de anexos da Tarefa pelo NAVEGADOR (2026-10-28) — mesma dança do
// card de Oportunidade (pipeline/_detail/enviar-anexos.ts): registra e
// assina a URL numa Server Action pequena, faz o PUT direto no Storage e,
// se o PUT falhar, apaga o registro sem arquivo (melhor esforço). Usado
// pela ficha (task-detail.tsx) e pelo cadastro (nova/nova-form.tsx).
export async function enviarAnexosTarefa(
  taskId: string,
  files: File[],
): Promise<{ lista: TaskAttachment[] | null; enviados: number; falhas: string[] }> {
  const falhas: string[] = [];
  let enviados = 0;

  for (const file of files) {
    const preparo = await prepareTaskAttachmentAction(taskId, {
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
      await removeTaskAttachmentAction(taskId, preparo.data.attachmentId).catch(() => null);
    }
  }

  const listagem = await listTaskAttachmentsAction(taskId);
  return { lista: listagem.ok ? listagem.data : null, enviados, falhas };
}
