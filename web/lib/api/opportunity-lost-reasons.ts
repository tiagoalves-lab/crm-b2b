// Lista de motivos de perda (2026-09-17) — ver
// src/opportunities/opportunity-lost-reason.service.ts. A oportunidade
// guarda o TEXTO do motivo (Opportunity.lostReason); a lista só garante
// que o mesmo motivo seja escrito sempre igual, pro Pareto agrupar.
import { apiFetch } from "./client";

export interface LostReason {
  id: string;
  nome: string;
  // Quantas oportunidades carregam este motivo (só vem na listagem).
  usos?: number;
}

export function listLostReasons(token: string): Promise<LostReason[]> {
  return apiFetch<LostReason[]>("/opportunity-lost-reasons", { token });
}

// Renomear leva junto as oportunidades já perdidas com o nome antigo.
export function renameLostReason(token: string, id: string, nome: string): Promise<LostReason> {
  return apiFetch<LostReason>(`/opportunity-lost-reasons/${id}`, {
    method: "PATCH",
    token,
    body: { nome },
  });
}

// Só motivo sem uso — o backend recusa com a explicação.
export function deleteLostReason(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/opportunity-lost-reasons/${id}`, { method: "DELETE", token });
}

export function createLostReason(token: string, nome: string): Promise<LostReason> {
  return apiFetch<LostReason>("/opportunity-lost-reasons", {
    method: "POST",
    token,
    body: { nome },
  });
}
