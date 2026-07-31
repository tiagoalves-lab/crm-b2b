"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import { createActivity } from "@/lib/api/activities";
import type { PessoaTipo } from "@/lib/api/types";
import {
  createCompany,
  deleteCompany,
  restoreCompany,
  updateCompany,
} from "@/lib/api/companies";

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

// Compartilhado entre create/update — os dois formulários (novo cadastro e
// aba "Dados cadastrais" da ficha) usam os mesmos names de campo.
function parseCompanyFields(formData: FormData) {
  const tipo = emptyToUndefined(formData.get("tipo")) as PessoaTipo | undefined;
  return {
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
  };
}

export async function createCompanyAction(formData: FormData) {
  const token = await getServerAccessToken();
  const name = String(formData.get("name") ?? "").trim();

  try {
    await createCompany(token, { name, ...parseCompanyFields(formData) });
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

// Aba "Dados cadastrais" da ficha — nome vem junto (campo obrigatório em
// Company), o resto reusa o mesmo parser do create.
export async function updateCompanyAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const back = String(formData.get("back") ?? "/dashboard/empresas");
  const name = emptyToUndefined(formData.get("name"));

  try {
    await updateCompany(token, id, { name, ...parseCompanyFields(formData) });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
}

// Campos fiscais estaduais (IE/contribuinte ICMS/situação) — vivem em
// customFields (jsonb), preenchimento manual (Receita não fornece IE).
export async function updateCustomFieldsAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const back = String(formData.get("back") ?? "/dashboard/empresas");

  try {
    await updateCompany(token, id, {
      customFields: {
        inscricao_estadual: emptyToUndefined(formData.get("inscricao_estadual")),
        contribuinte_icms: formData.get("contribuinte_icms") === "on",
        situacao_cadastral: emptyToUndefined(formData.get("situacao_cadastral")),
      },
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
}

// Aba "Timeline" da ficha — registra uma interação manual (nota, ligação,
// e-mail, reunião, visita ou pós-venda). Tipos que o protótipo tem e o
// enum do banco não viram "note" + subtipo no payload (SPEC-CRM-GAMA.md
// §3.3, opção simples — zero migration).
const SUBTYPE_TO_TYPE: Record<string, "note" | "call" | "email"> = {
  nota: "note",
  reuniao: "note",
  visita: "note",
  posvenda: "note",
  ligacao: "call",
  email: "email",
};

export async function createNoteAction(formData: FormData) {
  const token = await getServerAccessToken();
  const companyId = String(formData.get("companyId"));
  const back = String(formData.get("back") ?? "/dashboard/empresas");
  const subtipo = String(formData.get("subtipo") ?? "nota");
  const texto = String(formData.get("texto") ?? "").trim();

  if (!texto) {
    redirectWithError(back, new Error("Escreva algo antes de registrar."));
  }

  try {
    await createActivity(token, {
      companyId,
      type: SUBTYPE_TO_TYPE[subtipo] ?? "note",
      texto,
      subtipo,
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
}
