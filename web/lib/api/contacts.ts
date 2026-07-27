import { apiFetch } from "./client";
import type { Contact, PaginatedResult } from "./types";

export function listContacts(
  token: string,
  includeDeleted = false,
): Promise<PaginatedResult<Contact>> {
  const query = new URLSearchParams({ pageSize: "100" });
  if (includeDeleted) query.set("includeDeleted", "true");
  return apiFetch<PaginatedResult<Contact>>(`/contacts?${query.toString()}`, {
    token,
  });
}

export interface CreateContactInput {
  name: string;
  companyId?: string;
  email?: string;
  phone?: string;
  title?: string;
}

export function createContact(
  token: string,
  input: CreateContactInput,
): Promise<Contact> {
  return apiFetch<Contact>("/contacts", { method: "POST", token, body: input });
}

export function deleteContact(token: string, id: string): Promise<Contact> {
  return apiFetch<Contact>(`/contacts/${id}`, { method: "DELETE", token });
}

export function restoreContact(token: string, id: string): Promise<Contact> {
  return apiFetch<Contact>(`/contacts/${id}/restore`, {
    method: "POST",
    token,
  });
}
