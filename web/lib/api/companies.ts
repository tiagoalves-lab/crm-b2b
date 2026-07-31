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
}

export function lookupCnpj(
  token: string,
  cnpj: string,
): Promise<CnpjLookupResult> {
  return apiFetch<CnpjLookupResult>(`/companies/cnpj/${cnpj}`, { token });
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
