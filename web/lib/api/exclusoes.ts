import { apiFetch } from "./client";

// Tela "Registro de exclusões" (Administração, 2026-09-16). Só owner/admin:
// o backend responde 403 pros demais papéis, e o nav esconde o item.

export const ENTIDADES = [
  { id: "tarefa", label: "Tarefa" },
  { id: "tarefa_comentario", label: "Comentário de tarefa" },
  { id: "tarefa_anexo", label: "Anexo de tarefa" },
  { id: "tarefa_checklist", label: "Item de checklist" },
  { id: "oportunidade", label: "Oportunidade" },
  { id: "oportunidade_comentario", label: "Comentário de oportunidade" },
  { id: "oportunidade_anexo", label: "Anexo de oportunidade" },
  { id: "oportunidade_item", label: "Item de oportunidade" },
  { id: "empresa", label: "Empresa" },
  { id: "contato", label: "Contato" },
  { id: "membro", label: "Membro" },
  { id: "pipeline", label: "Pipeline" },
  { id: "etapa", label: "Etapa do pipeline" },
  { id: "motivo_perda", label: "Motivo de perda" },
] as const;

export function entidadeLabel(id: string): string {
  return ENTIDADES.find((e) => e.id === id)?.label ?? id;
}

export interface Exclusao {
  id: string;
  entidade: string;
  registroId: string;
  titulo: string;
  contexto: string | null;
  actorUserId: string;
  criadoEm: string;
  // Cópia do registro como estava antes de sair (e o que foi junto).
  snapshot: Record<string, unknown>;
}

export interface ExclusoesPage {
  total: number;
  page: number;
  pageSize: number;
  items: Exclusao[];
}

export function listExclusoes(
  token: string,
  params: { entidade?: string; page?: number },
): Promise<ExclusoesPage> {
  const query = new URLSearchParams();
  if (params.entidade) query.set("entidade", params.entidade);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  query.set("pageSize", "50");
  return apiFetch<ExclusoesPage>(`/exclusoes?${query.toString()}`, { token });
}
