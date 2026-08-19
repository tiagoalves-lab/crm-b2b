// Agenda de contatos de uma empresa (feature nova, fora do
// SPEC-CRM-GAMA.md original) — mirror de opportunity-comments.ts.
import { apiFetch } from "./client";
import type { Contact } from "./types";

export function listContacts(token: string, companyId: string): Promise<Contact[]> {
  return apiFetch<Contact[]>(`/companies/${companyId}/contacts`, { token });
}

// Prévia em lote pra listas (Prospecção, 2026-08-07) — uma chamada só pra
// N empresas, em vez de listContacts() acima N vezes (evita N+1 round-trip
// numa tabela que pode ter até 200 linhas). Devolve tudo achatado — quem
// chama agrupa por companyId (ver leads/page.tsx).
// POST, não GET com ?companyIds=... — a lista de Prospecção não tem mais
// teto de 200 itens (2026-08-10), então a URL com todos os companyIds
// podia passar de centenas de KB e a requisição voltava 431 (header
// grande demais) antes de chegar no backend, quebrando a página inteira.
// Corpo de POST não tem esse teto.
export function listContactsByCompanyIds(token: string, companyIds: string[]): Promise<Contact[]> {
  if (companyIds.length === 0) return Promise.resolve([]);
  return apiFetch<Contact[]>(`/contacts`, {
    method: "POST",
    token,
    body: { companyIds },
  });
}

export interface CreateContactInput {
  nome: string;
  cargo?: string;
  email?: string;
  telefone?: string;
  decisor?: boolean;
}

export function createContact(
  token: string,
  companyId: string,
  data: CreateContactInput,
): Promise<Contact> {
  return apiFetch<Contact>(`/companies/${companyId}/contacts`, {
    method: "POST",
    token,
    body: data,
  });
}

// Só owner/admin (backend valida de novo — ver src/companies/contact.service.ts
// WRITE_ROLES; isto aqui só evita a chamada óbvia, não é a fronteira de
// segurança). Representante (sales_rep) só usa createContact/listContacts.
export function updateContact(
  token: string,
  companyId: string,
  contactId: string,
  data: { nome?: string; cargo?: string; email?: string; telefone?: string; decisor?: boolean },
): Promise<Contact> {
  return apiFetch<Contact>(`/companies/${companyId}/contacts/${contactId}`, {
    method: "PATCH",
    token,
    body: data,
  });
}

export function deleteContact(
  token: string,
  companyId: string,
  contactId: string,
): Promise<void> {
  return apiFetch<void>(`/companies/${companyId}/contacts/${contactId}`, {
    method: "DELETE",
    token,
  });
}
