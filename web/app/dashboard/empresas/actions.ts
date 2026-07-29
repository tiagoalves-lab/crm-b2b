"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import type { PessoaTipo } from "@/lib/api/types";
import { createCompany, deleteCompany, restoreCompany } from "@/lib/api/companies";

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

function toList(value: FormDataEntryValue | null): string[] | undefined {
  const str = value ? String(value).trim() : "";
  if (str === "") return undefined;
  return str
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

export async function createCompanyAction(formData: FormData) {
  const token = await getServerAccessToken();
  const name = String(formData.get("name") ?? "").trim();
  const tipo = emptyToUndefined(formData.get("tipo")) as PessoaTipo | undefined;

  try {
    await createCompany(token, {
      name,
      domain: emptyToUndefined(formData.get("domain")),
      industry: emptyToUndefined(formData.get("industry")),
      size: emptyToUndefined(formData.get("size")),
      razaoSocial: emptyToUndefined(formData.get("razaoSocial")),
      fantasia: emptyToUndefined(formData.get("fantasia")),
      nomeParaContato: emptyToUndefined(formData.get("nomeParaContato")),
      cpfCnpj: emptyToUndefined(formData.get("cpfCnpj")),
      tipo,
      dtNasc: emptyToUndefined(formData.get("dtNasc")),
      dtCad: emptyToUndefined(formData.get("dtCad")),
      emails: toList(formData.get("emails")),
      fones: toList(formData.get("fones")),
      logradouro: emptyToUndefined(formData.get("logradouro")),
      numero: emptyToUndefined(formData.get("numero")),
      complemento: emptyToUndefined(formData.get("complemento")),
      bairro: emptyToUndefined(formData.get("bairro")),
      cep: emptyToUndefined(formData.get("cep")),
      cidade: emptyToUndefined(formData.get("cidade")),
      uf: emptyToUndefined(formData.get("uf")),
      tags: toList(formData.get("tags")),
    });
  } catch (error) {
    redirectWithError("/dashboard/empresas", error);
  }

  revalidatePath("/dashboard/empresas");
}

export async function deleteCompanyAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await deleteCompany(token, id);
  } catch (error) {
    redirectWithError("/dashboard/empresas", error);
  }

  revalidatePath("/dashboard/empresas");
}

export async function restoreCompanyAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await restoreCompany(token, id);
  } catch (error) {
    redirectWithError("/dashboard/empresas", error);
  }

  revalidatePath("/dashboard/empresas");
}
