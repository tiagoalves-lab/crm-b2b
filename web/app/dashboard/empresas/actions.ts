"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { createActivity } from "@/lib/api/activities";
import type { PessoaTipo } from "@/lib/api/types";
import {
  createCompany,
  deleteCompany,
  getCompany,
  lookupCnpj,
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
  const back = String(formData.get("back") ?? "/dashboard/empresas");
  const fields = parseCompanyFields(formData);

  // Company não tem mais campo obrigatório fixo (ver schema.prisma) —
  // exige aqui, não no backend, que ao menos um identificador esteja
  // preenchido, senão a lista/cards ficam com "Empresa sem nome"
  // (fallback de companyDisplayName).
  if (!fields.razaoSocial && !fields.fantasia) {
    redirectWithError(back, new Error("Preencha Razão social ou Fantasia."));
  }

  try {
    await createCompany(token, fields);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
  redirectWithMessage("/dashboard/empresas", "Empresa criada");
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
  redirectWithMessage("/dashboard/empresas", "Empresa excluída");
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
  redirectWithMessage("/dashboard/empresas", "Empresa restaurada");
}

// Modal "Editar empresa" (aberto a partir da ficha) — reusa o mesmo
// parser do create; o form já vem pré-preenchido, então razaoSocial/
// fantasia só chegam vazios aqui se o usuário limpou os dois de propósito.
export async function updateCompanyAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const back = String(formData.get("back") ?? "/dashboard/empresas");
  const fields = parseCompanyFields(formData);

  if (!fields.razaoSocial && !fields.fantasia) {
    redirectWithError(back, new Error("Preencha Razão social ou Fantasia."));
  }

  try {
    await updateCompany(token, id, fields);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
  redirectWithMessage(back, "Empresa atualizada");
}

// Campos fiscais estaduais (IE/contribuinte ICMS/situação) — vivem em
// customFields (jsonb), preenchimento manual (Receita não fornece IE).
// `customFields` é substituído por inteiro pelo Prisma (não faz merge —
// ver src/companies/company.service.ts `update()`), então é preciso ler o
// que já existe (ex.: o snapshot da busca de CNPJ salvo por
// refreshCnpjDataAction) e mesclar aqui antes de salvar, senão cada save
// desta aba apaga silenciosamente os outros campos de customFields.
export async function updateCustomFieldsAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const back = String(formData.get("back") ?? "/dashboard/empresas");

  try {
    const current = await getCompany(token, id);
    await updateCompany(token, id, {
      customFields: {
        ...current.customFields,
        inscricao_estadual: emptyToUndefined(formData.get("inscricao_estadual")),
        contribuinte_icms: formData.get("contribuinte_icms") === "on",
        situacao_cadastral: emptyToUndefined(formData.get("situacao_cadastral")),
      },
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
  redirectWithMessage(back, "Dados fiscais salvos");
}

// Aba "Dados cadastrais" — busca a Receita Federal (BrasilAPI, via proxy
// já existente) e persiste tanto os campos "de verdade" de Company
// (razão social/endereço/contato) quanto um snapshot em
// customFields.cnpj_lookup com os campos só-leitura que a ficha exibe
// (situação/CNAE/porte/natureza jurídica — SPEC-CRM-GAMA.md §4.1, cad-grid
// do protótipo). Mesmo cuidado de merge do updateCustomFieldsAction acima.
export async function refreshCnpjDataAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const back = String(formData.get("back") ?? "/dashboard/empresas");
  // Campo reusa company.cpfCnpj como defaultValue (ficha-body.tsx), que
  // pode estar salvo com pontuação — limpa aqui antes de repassar adiante
  // (lookupCnpj já limpa de novo por conta própria, mas mantém os dois
  // pontos limpos como pedido, não só um).
  const cnpj = String(formData.get("cnpj") ?? "").replace(/\D/g, "");

  if (cnpj.length !== 14) {
    redirectWithError(back, new Error("Informe um CNPJ com 14 dígitos."));
  }

  try {
    const [current, lookup] = await Promise.all([getCompany(token, id), lookupCnpj(token, cnpj)]);
    await updateCompany(token, id, {
      razaoSocial: lookup.razaoSocial,
      fantasia: lookup.fantasia,
      cpfCnpj: lookup.cpfCnpj,
      tipo: "PJ",
      emails: lookup.emails,
      fones: lookup.fones,
      logradouro: lookup.logradouro,
      numero: lookup.numero,
      complemento: lookup.complemento,
      bairro: lookup.bairro,
      cep: lookup.cep,
      cidade: lookup.cidade,
      uf: lookup.uf,
      customFields: {
        ...current.customFields,
        cnpj_lookup: {
          situacaoCadastral: lookup.situacaoCadastral ?? null,
          dataAbertura: lookup.dataAbertura ?? null,
          porte: lookup.porte ?? null,
          naturezaJuridica: lookup.naturezaJuridica ?? null,
          cnaePrincipal: lookup.cnaePrincipal ?? null,
          cnaeSecundarios: lookup.cnaeSecundarios ?? [],
          estabelecimento: lookup.estabelecimento ?? null,
          telefoneReceita: lookup.fones[0] ?? null,
          emailReceita: lookup.emails[0] ?? null,
          fonteFederal: "Receita Federal · BrasilAPI",
          buscadoEm: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
  redirectWithMessage(back, "Dados da Receita carregados");
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
  redirectWithMessage(back, "Interação registrada");
}
