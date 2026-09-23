import { apiFetch } from "./client";
import type { CompanyRef } from "./types";

// Relatórios da tela Relatórios (2026-09-23) — backend em
// src/relatorios/. Nada a ver com lib/api/reports (e-mails automáticos).

export interface AnotacaoRelatorioRow {
  id: string;
  occurredAt: string;
  subtipo: string;
  texto: string;
  actorUserId: string | null;
  contatoNome: string | null;
  company: CompanyRef | null;
}

export interface AnotacoesRelatorio {
  rows: AnotacaoRelatorioRow[];
  total: number;
  truncado: boolean;
}

export interface AnotacoesFiltro {
  // Dia civil de Brasília ("AAAA-MM-DD") — o backend converte.
  inicio: string;
  fim: string;
  subtipo?: string;
  usuarioId?: string;
  empresa?: string;
}

export function gerarRelatorioAnotacoes(
  token: string,
  filtro: AnotacoesFiltro,
): Promise<AnotacoesRelatorio> {
  const query = new URLSearchParams({ inicio: filtro.inicio, fim: filtro.fim });
  if (filtro.subtipo) query.set("subtipo", filtro.subtipo);
  if (filtro.usuarioId) query.set("usuarioId", filtro.usuarioId);
  if (filtro.empresa) query.set("empresa", filtro.empresa);
  return apiFetch<AnotacoesRelatorio>(`/relatorios/anotacoes?${query.toString()}`, {
    token,
  });
}

export interface TarefaConcluidaRow {
  id: string;
  concluidaEm: string;
  titulo: string;
  descricao: string | null;
  tipo: string | null;
  dueAt: string | null;
  assigneeUserId: string;
  company: CompanyRef | null;
}

export interface TarefasConcluidasRelatorio {
  rows: TarefaConcluidaRow[];
  total: number;
  truncado: boolean;
}

export interface TarefasConcluidasFiltro {
  inicio: string;
  fim: string;
  tipo?: string;
  usuarioId?: string;
  empresa?: string;
}

export function gerarRelatorioTarefasConcluidas(
  token: string,
  filtro: TarefasConcluidasFiltro,
): Promise<TarefasConcluidasRelatorio> {
  const query = new URLSearchParams({ inicio: filtro.inicio, fim: filtro.fim });
  if (filtro.tipo) query.set("tipo", filtro.tipo);
  if (filtro.usuarioId) query.set("usuarioId", filtro.usuarioId);
  if (filtro.empresa) query.set("empresa", filtro.empresa);
  return apiFetch<TarefasConcluidasRelatorio>(
    `/relatorios/tarefas-concluidas?${query.toString()}`,
    { token },
  );
}
