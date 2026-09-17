// Anexos do card de Oportunidade (feature nova, fora do SPEC-CRM-GAMA.md
// original) — mirror de task-attachments.ts.
import { apiFetch } from "./client";

export interface OpportunityAttachment {
  id: string;
  opportunityId: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string;
  createdAt: string;
  // Publicação (2026-09-15): null = reservado, só owner/admin enxergam.
  // Quem não pode publicar nunca recebe um anexo reservado do backend —
  // este campo é só pra tela mostrar o selo e o botão de publicar.
  publishedAt: string | null;
}

export function listAttachments(token: string, opportunityId: string): Promise<OpportunityAttachment[]> {
  return apiFetch<OpportunityAttachment[]>(`/opportunities/${opportunityId}/attachments`, { token });
}

export interface CreateUploadUrlInput {
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface CreateUploadUrlResult {
  attachment: OpportunityAttachment;
  uploadUrl: string;
  token: string;
}

// Só cria o metadado + assina a URL — quem faz o PUT do binário é quem
// chamou isto (Server Action), direto pro Storage, não passa pelo NestJS.
export function createUploadUrl(
  token: string,
  opportunityId: string,
  input: CreateUploadUrlInput,
): Promise<CreateUploadUrlResult> {
  return apiFetch<CreateUploadUrlResult>(`/opportunities/${opportunityId}/attachments`, {
    method: "POST",
    token,
    body: input,
  });
}

export function getDownloadUrl(
  token: string,
  opportunityId: string,
  attachmentId: string,
): Promise<{ url: string; fileName: string }> {
  return apiFetch<{ url: string; fileName: string }>(
    `/opportunities/${opportunityId}/attachments/${attachmentId}/download`,
    { token },
  );
}

// Libera o anexo pra gerente e representante. Sem volta.
export function publishAttachment(
  token: string,
  opportunityId: string,
  attachmentId: string,
): Promise<OpportunityAttachment> {
  return apiFetch<OpportunityAttachment>(
    `/opportunities/${opportunityId}/attachments/${attachmentId}/publish`,
    { method: "POST", token },
  );
}

export function deleteAttachment(
  token: string,
  opportunityId: string,
  attachmentId: string,
): Promise<void> {
  return apiFetch<void>(`/opportunities/${opportunityId}/attachments/${attachmentId}`, {
    method: "DELETE",
    token,
  });
}
