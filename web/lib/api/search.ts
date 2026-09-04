import { apiFetch } from "./client";
import type { LeadTier, OpportunityStatus, RawLeadStatus, TaskStatus, TaskType } from "./types";

export interface BuscaEmpresaLeadResult {
  id: string;
  origem: "empresa" | "lead";
  nome: string;
  cnpj: string | null;
}

// Seletor de empresa/lead do "Nova oportunidade" (SPEC-CRM-GAMA.md
// §3.5/§4.2.1) — busca sobre a view v_busca_empresa_lead.
export function searchEmpresaLead(
  token: string,
  q: string,
): Promise<BuscaEmpresaLeadResult[]> {
  return apiFetch<BuscaEmpresaLeadResult[]>(
    `/busca-empresa-lead?q=${encodeURIComponent(q)}`,
    { token },
  );
}

// Busca geral (GET /busca?q=) — espelho de src/search/global-search.service.ts
// no backend (mantido à mão, sem tipos compartilhados entre os dois
// projetos npm). Seção ausente = usuário sem permissão de 'ver' naquele
// módulo; seção vazia = nada encontrado.

export interface EmpresaEncontrada {
  id: string;
  nome: string;
  razaoSocial: string | null;
  cpfCnpj: string | null;
  cidade: string | null;
  uf: string | null;
  curvaAbc: "A" | "B" | "C" | null;
}

export interface ContatoEncontrado {
  id: string;
  companyId: string;
  empresa: string;
  nome: string;
  cargo: string | null;
  email: string | null;
  telefone: string | null;
  decisor: boolean;
}

export interface LeadEncontrado {
  id: string;
  razaoSocial: string;
  cnpj: string | null;
  municipio: string | null;
  uf: string | null;
  status: RawLeadStatus;
  score: number;
  manualTier: LeadTier | null;
  segmento: string | null;
}

export interface OportunidadeEncontrada {
  id: string;
  companyId: string;
  empresa: string;
  etapa: string;
  amount: string;
  currency: string;
  status: OpportunityStatus;
  expectedCloseDate: string | null;
}

export interface TarefaEncontrada {
  id: string;
  title: string;
  status: TaskStatus;
  tipo: TaskType | null;
  dueAt: string | null;
  assigneeUserId: string;
  empresa: string | null;
}

export interface GlobalSearchResult {
  q: string;
  empresas?: EmpresaEncontrada[];
  contatos?: ContatoEncontrado[];
  prospeccao?: LeadEncontrado[];
  pipeline?: OportunidadeEncontrada[];
  tarefas?: TarefaEncontrada[];
}

export function globalSearch(token: string, q: string): Promise<GlobalSearchResult> {
  return apiFetch<GlobalSearchResult>(`/busca?q=${encodeURIComponent(q)}`, { token });
}
