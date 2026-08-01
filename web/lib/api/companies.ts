import { apiFetch } from "./client";
import type { Company, PaginatedResult, PessoaTipo } from "./types";

// Company não guarda mais um "nome" próprio (coluna removida em
// 2026-08-01, decisão do usuário — era redundante com razão
// social/fantasia, que já cobriam o mesmo caso de uso e ainda por cima
// preenchem sozinhos via busca de CNPJ). Todo lugar que exibia
// company.name passa a chamar isto — mesma ordem de prioridade usada na
// migration pra view v_busca_empresa_lead (fantasia > razão social >
// nome pra contato), pra bater com o que a busca de empresa/lead mostra.
export function companyDisplayName(
  company: Pick<Company, "fantasia" | "razaoSocial" | "nomeParaContato">,
): string {
  return (
    company.fantasia?.trim() ||
    company.razaoSocial?.trim() ||
    company.nomeParaContato?.trim() ||
    "Empresa sem nome"
  );
}

// Telefone chega do banco só com dígitos (import antigo não normalizou
// pontuação). Formata só quando bate DDD+número (10 ou 11 dígitos) — pra
// entrada fora desse padrão (dado sujo de importação), devolve como veio em
// vez de arriscar formatar errado.
export function formatPhoneBR(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function listCompanies(
  token: string,
  includeDeleted = false,
): Promise<PaginatedResult<Company>> {
  const query = new URLSearchParams({ pageSize: "100" });
  if (includeDeleted) query.set("includeDeleted", "true");
  return apiFetch<PaginatedResult<Company>>(`/companies?${query.toString()}`, {
    token,
  });
}

export interface CreateCompanyInput {
  domain?: string;
  industry?: string;
  size?: string;
  razaoSocial?: string;
  fantasia?: string;
  nomeParaContato?: string;
  cpfCnpj?: string;
  tipo?: PessoaTipo;
  dtNasc?: string;
  dtCad?: string;
  emails?: string[];
  fones?: string[];
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  tags?: string[];
}

export function createCompany(
  token: string,
  input: CreateCompanyInput,
): Promise<Company> {
  return apiFetch<Company>("/companies", { method: "POST", token, body: input });
}

export function getCompany(token: string, id: string): Promise<Company> {
  return apiFetch<Company>(`/companies/${id}`, { token });
}

export type UpdateCompanyInput = Partial<CreateCompanyInput> & {
  customFields?: Record<string, unknown>;
};

export function updateCompany(
  token: string,
  id: string,
  input: UpdateCompanyInput,
): Promise<Company> {
  return apiFetch<Company>(`/companies/${id}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export interface CnpjLookupResult {
  razaoSocial?: string;
  fantasia?: string;
  cpfCnpj: string;
  tipo: "PJ";
  emails: string[];
  fones: string[];
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  situacaoCadastral?: string;
  dataAbertura?: string;
  porte?: string;
  naturezaJuridica?: string;
  cnaePrincipal?: string;
  cnaeSecundarios?: string[];
  estabelecimento?: string;
}

// Extrai só dígitos antes de montar a URL — o valor pode vir com pontuação
// (ex. "12.345.678/0001-99" digitado direto no campo CPF/CNPJ da empresa,
// reusado como defaultValue em refreshCnpjDataAction). Sem isso, uma "/"
// no meio do CNPJ quebra o roteamento do Nest (vira 2 segmentos de URL em
// vez de 1 param) e o pedido nem chega no backend — 404 "Cannot GET...".
export function lookupCnpj(
  token: string,
  cnpj: string,
): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, "");
  return apiFetch<CnpjLookupResult>(`/companies/cnpj/${digits}`, { token });
}

export function deleteCompany(token: string, id: string): Promise<Company> {
  return apiFetch<Company>(`/companies/${id}`, { method: "DELETE", token });
}

export function restoreCompany(token: string, id: string): Promise<Company> {
  return apiFetch<Company>(`/companies/${id}/restore`, {
    method: "POST",
    token,
  });
}
