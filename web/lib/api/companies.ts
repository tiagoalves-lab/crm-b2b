import { apiFetch } from "./client";
import type { Company, PaginatedResult, PessoaTipo } from "./types";

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
  name: string;
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
