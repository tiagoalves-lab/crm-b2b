import { apiFetch } from "./client";

export interface TaskAttachment {
  id: string;
  taskId: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string;
  createdAt: string;
}

export function listAttachments(token: string, taskId: string): Promise<TaskAttachment[]> {
  return apiFetch<TaskAttachment[]>(`/tasks/${taskId}/attachments`, { token });
}

export interface CreateUploadUrlInput {
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface CreateUploadUrlResult {
  attachment: TaskAttachment;
  uploadUrl: string;
  token: string;
}

// Só cria o metadado + assina a URL — quem faz o PUT do binário é quem
// chamou isto (Server Action), direto pro Storage, não passa pelo NestJS.
export function createUploadUrl(
  token: string,
  taskId: string,
  input: CreateUploadUrlInput,
): Promise<CreateUploadUrlResult> {
  return apiFetch<CreateUploadUrlResult>(`/tasks/${taskId}/attachments`, {
    method: "POST",
    token,
    body: input,
  });
}

export function getDownloadUrl(
  token: string,
  taskId: string,
  attachmentId: string,
): Promise<{ url: string; fileName: string }> {
  return apiFetch<{ url: string; fileName: string }>(
    `/tasks/${taskId}/attachments/${attachmentId}/download`,
    { token },
  );
}

export function deleteAttachment(
  token: string,
  taskId: string,
  attachmentId: string,
): Promise<void> {
  return apiFetch<void>(`/tasks/${taskId}/attachments/${attachmentId}`, {
    method: "DELETE",
    token,
  });
}
