import { apiFetch } from "./client";
import type { CompanyRef, RawLeadEtapa, RawLeadStatus } from "./types";

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

// Etapa do funil da empresa e o dia em que entrou em cada uma (null =
// passagem que não aconteceu). Empresa sem lead não vem na lista.
export interface FunilDaEmpresa {
  companyId: string;
  etapa: RawLeadEtapa;
  status: RawLeadStatus;
  entradaAt: string;
  andamentoAt: string | null;
  reuniaoAt: string | null;
  qualifiedAt: string | null;
  convertedAt: string | null;
  discardedAt: string | null;
}

export interface AnotacoesRelatorio {
  rows: AnotacaoRelatorioRow[];
  funis: FunilDaEmpresa[];
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

export interface ContatoRelatorioRow {
  id: string;
  nome: string;
  cargo: string | null;
  email: string | null;
  telefone: string | null;
  decisor: boolean;
  ownerUserId: string | null;
  createdAt: string;
  company: (CompanyRef & { cpfCnpj: string | null }) | null;
}

export interface ContatosRelatorio {
  rows: ContatoRelatorioRow[];
  total: number;
  truncado: boolean;
}

export interface ContatosFiltro {
  // Período de cadastro é opcional neste relatório — os dois ou nenhum.
  inicio?: string;
  fim?: string;
  usuarioId?: string;
  decisor?: "sim" | "nao";
  empresa?: string;
  contato?: string;
}

export function gerarRelatorioContatos(
  token: string,
  filtro: ContatosFiltro,
): Promise<ContatosRelatorio> {
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtro)) {
    if (valor) query.set(chave, valor);
  }
  return apiFetch<ContatosRelatorio>(`/relatorios/contatos?${query.toString()}`, { token });
}

// Relatório "SLA de Oportunidades" (2026-10-28) — histograma de dias úteis
// de SLA por proposta, mesma conta do selo do card do Pipeline.
export interface SlaOportunidadeRow {
  id: string;
  abertaEm: string;
  inicioSla: string;
  fimSla: string | null;
  dias: number;
  pendente: boolean;
  revisado: boolean;
  etapa: string;
  status: string;
  ownerUserId: string;
  company: CompanyRef | null;
}

export interface SlaFaixa {
  dias: number;
  total: number;
  pendentes: number;
}

export interface SlaResumo {
  total: number;
  mediana: number | null;
  media: number | null;
  maximo: number | null;
  corte: number;
  diasNoCorte: number | null;
  ateCorte: number;
  pendentes: number;
}

export interface SlaOportunidadesRelatorio {
  faixas: SlaFaixa[];
  resumo: SlaResumo;
  rows: SlaOportunidadeRow[];
  total: number;
  truncado: boolean;
}

export interface SlaOportunidadesFiltro {
  inicio: string;
  fim: string;
  usuarioId?: string;
}

export function gerarRelatorioSlaOportunidades(
  token: string,
  filtro: SlaOportunidadesFiltro,
): Promise<SlaOportunidadesRelatorio> {
  const query = new URLSearchParams({ inicio: filtro.inicio, fim: filtro.fim });
  if (filtro.usuarioId) query.set("usuarioId", filtro.usuarioId);
  return apiFetch<SlaOportunidadesRelatorio>(
    `/relatorios/sla-oportunidades?${query.toString()}`,
    { token },
  );
}
