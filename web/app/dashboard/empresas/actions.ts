"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { errorMessage, redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { createActivity } from "@/lib/api/activities";
import { createContact, deleteContact, updateContact } from "@/lib/api/contacts";
import type { Activity, Contact, PessoaTipo } from "@/lib/api/types";
import {
  calcularCurvaAbc,
  createCompany,
  deleteCompany,
  getCompany,
  lookupCnpj,
  restoreCompany,
  updateCompany,
} from "@/lib/api/companies";
import { propagarCompanyParaEgestor } from "@/lib/api/egestor";

// Propagação CRM → eGestor depois de salvar a ficha (decisão do usuário,
// 2026-08-14: "eu altero no CRM e ao salvar ele propaga"). Só roda depois
// do save ter dado certo — o cadastro do CRM é o que manda, a propagação é
// consequência.
//
// Nunca derruba a ação: o save já aconteceu e não dá pra desfazer, então
// falhar aqui e mostrar erro daria a impressão falsa de que nada foi
// gravado. O desfecho vira sufixo da mensagem de sucesso. Erro de verdade
// (rede/eGestor fora do ar) também vira sufixo, com o texto do erro, pra
// não ficar silencioso — o histórico de requisições da tela Integração
// eGestor guarda o registro completo.
async function propagarSufixo(token: string, companyId: string): Promise<string> {
  try {
    const resultado = await propagarCompanyParaEgestor(token, companyId);
    if (!resultado.propagado) return "";
    const lados = resultado.lados
      .map((lado) => (lado === "matriz" ? "Matriz" : "Filial"))
      .join(" e ");
    return ` — propagado pro eGestor ${lados}`;
  } catch (error) {
    return ` — mas falhou ao propagar pro eGestor: ${errorMessage(error)}`;
  }
}

// `indicadorIE` do eGestor — guardado como NÚMERO puro (1/2/9), que é o
// único formato que a API aceita no corpo do POST/PUT (decisão do usuário,
// 2026-08-17; ver docs/api-egestor-contatos.md). Qualquer coisa fora do
// enum, inclusive o "Não informado" do select, volta `undefined`: a chave
// some do cadastro e o CRM deixa de opinar sobre esse campo, em vez de
// afirmar um valor que ninguém escolheu.
function indicadorIeFromForm(value: FormDataEntryValue | null): number | undefined {
  const str = value ? String(value).trim() : "";
  return str === "1" || str === "2" || str === "9" ? Number(str) : undefined;
}

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

export type CreateCompanyState = { ok: true } | { ok: false; message: string };

// Chamado via useActionState (company-form.tsx), não `<form action=...>`
// direto — devolve o resultado em vez de redirecionar mesmo no sucesso,
// pro form fechar o modal com router.push no client depois de confirmar
// que criou. redirect() daqui de dentro tecnicamente atualiza a URL, mas
// não derruba o slot @modal da rota interceptada (bug conhecido do Next
// App Router com Server Action + intercepting routes) — o modal ficava
// aberto com o registro já salvo.
export async function createCompanyAction(
  _prevState: CreateCompanyState | null,
  formData: FormData,
): Promise<CreateCompanyState> {
  const token = await getServerAccessToken();
  const fields = parseCompanyFields(formData);

  // Company não tem mais campo obrigatório fixo (ver schema.prisma) —
  // exige aqui, não no backend, que ao menos um identificador esteja
  // preenchido, senão a lista/cards ficam com "Empresa sem nome"
  // (fallback de companyDisplayName).
  if (!fields.razaoSocial && !fields.fantasia) {
    return { ok: false, message: "Preencha Razão social ou Fantasia." };
  }

  try {
    await createCompany(token, fields);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  revalidatePath("/dashboard/empresas");
  return { ok: true };
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

// Botão "Calcular curva ABC" (pedido do usuário, 2026-08-21). Recalcula
// a classe de TODOS os clientes de uma vez e grava — por isso é uma ação
// explícita, não um cálculo de tela: a classe precisa ficar estável entre
// uma revisão e outra.
export async function calcularCurvaAbcAction() {
  const token = await getServerAccessToken();

  let resumo;
  try {
    resumo = await calcularCurvaAbc(token);
  } catch (error) {
    redirectWithError("/dashboard/empresas", error);
  }

  revalidatePath("/dashboard/empresas");
  redirectWithMessage(
    "/dashboard/empresas",
    `Curva ABC recalculada: ${resumo.a} cliente(s) classe A, ${resumo.b} classe B e ${resumo.c} classe C${resumo.semCompra > 0 ? `; ${resumo.semCompra} empresa(s) sem compra ficaram sem classe` : ""}.`,
  );
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

  const sufixo = await propagarSufixo(token, id);

  revalidatePath("/dashboard/empresas");
  redirectWithMessage(back, `Empresa atualizada${sufixo}`);
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
        indicador_ie: indicadorIeFromForm(formData.get("indicador_ie")),
        // Campos que saíram do formulário em 2026-08-17: `contribuinte_icms`
        // (substituído pelo `indicador_ie` acima) e `situacao_cadastral`
        // estadual (removido a pedido do usuário — a situação que interessa
        // é a federal, que já vem da Receita em customFields.cnpj_lookup).
        // Explicitados como undefined em vez de só apagados daqui: o spread
        // de `current.customFields` acima traria a chave antiga de volta em
        // qualquer empresa que já a tivesse gravada, e ela ficaria pra
        // sempre num cadastro sem tela que a mostre.
        contribuinte_icms: undefined,
        situacao_cadastral: undefined,
      },
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  const sufixo = await propagarSufixo(token, id);

  revalidatePath("/dashboard/empresas");
  redirectWithMessage(back, `Dados fiscais salvos${sufixo}`);
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
      emRecuperacaoJudicial: lookup.emRecuperacaoJudicial,
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

// RPC via Server Action (não <form action=...>) — pedido direto do
// usuário (2026-08-05): a versão antiga (FormData + redirectWithMessage)
// forçava uma navegação de volta pra mesma URL a cada "Registrar", e isso
// fechava e reabria o drawer/modal interceptado da ficha (mesmo gotcha já
// documentado: só router.back() colapsa o slot @modal/@drawer nesta
// versão do Next — redirect()/router.push() não fecham o overlay, mas
// ainda disparam um ciclo de navegação que pisca a UI inteira). Sem
// redirect nenhum: devolve o resultado pro client component
// (AddNoteForm) chamar router.refresh() — atualiza só os dados da rota
// atual sem navegar, então o drawer nunca fecha, só a Timeline ganha o
// registro novo.
export async function createNoteRpcAction(
  companyId: string,
  data: { subtipo: string; texto: string; contactId?: string },
): Promise<ActionResult<Activity>> {
  const token = await getServerAccessToken();
  try {
    const activity = await createActivity(token, {
      companyId,
      type: SUBTYPE_TO_TYPE[data.subtipo] ?? "note",
      texto: data.texto,
      subtipo: data.subtipo,
      contactId: data.contactId,
    });
    revalidatePath("/dashboard/empresas");
    revalidatePath("/dashboard/leads");
    return { ok: true, data: activity };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

// Aba "Contatos" da ficha (entre "Dados cadastrais" e "Timeline") —
// reusada tal e qual na ficha de Leads (companyId = RawLead.
// promotedCompanyId), feature nova fora do SPEC-CRM-GAMA.md original.
export async function createContactAction(formData: FormData) {
  const token = await getServerAccessToken();
  const companyId = String(formData.get("companyId"));
  const back = String(formData.get("back") ?? "/dashboard/empresas");
  const nome = String(formData.get("nome") ?? "").trim();

  if (!nome) {
    redirectWithError(back, new Error("Informe o nome do contato."));
  }

  try {
    await createContact(token, companyId, {
      nome,
      cargo: emptyToUndefined(formData.get("cargo")),
      email: emptyToUndefined(formData.get("email")),
      telefone: emptyToUndefined(formData.get("telefone")),
      decisor: formData.get("decisor") === "on",
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
  revalidatePath("/dashboard/leads");
  redirectWithMessage(back, "Contato adicionado");
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

// Versões RPC de criar/remover contato (2026-08-13).
//
// As versões com `<form action=...>` + redirectWithMessage acima faziam a
// aba "Contatos" pagar uma navegação inteira por clique: o redirect
// remonta o layout e recarrega a ficha toda, o que dentro do drawer/modal
// interceptado aparece como um piscar da tela e vários segundos de espera
// — e era nessa espera que o usuário clicava de novo e criava o contato
// duplicado. Mesmo tratamento que a aba Timeline já tinha recebido
// (createNoteRpcAction, logo acima): sem redirect, devolve o resultado
// pro client component chamar router.refresh(), que atualiza só os dados
// da rota atual sem navegar — o drawer nunca fecha.
export async function createContactRpcAction(
  companyId: string,
  data: { nome: string; cargo?: string; email?: string; telefone?: string; decisor: boolean },
): Promise<ActionResult<Contact>> {
  const token = await getServerAccessToken();

  const nome = data.nome.trim();
  if (!nome) {
    return { ok: false, message: "Informe o nome do contato." };
  }

  try {
    const contact = await createContact(token, companyId, { ...data, nome });
    revalidatePath("/dashboard/empresas");
    revalidatePath("/dashboard/leads");
    return { ok: true, data: contact };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function deleteContactRpcAction(
  companyId: string,
  contactId: string,
): Promise<ActionResult<null>> {
  const token = await getServerAccessToken();
  try {
    await deleteContact(token, companyId, contactId);
    revalidatePath("/dashboard/empresas");
    revalidatePath("/dashboard/leads");
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

// Chamada via onClick (contact-item.tsx), não <form action> — devolve o
// contato atualizado em vez de redirecionar, pro item da lista voltar do
// modo de edição pro modo de exibição sem sair da ficha (mesmo motivo de
// approveLeadForOpportunityAction em leads/actions.ts). Backend restringe
// a owner/admin (ContactService#mustBeAdminOrOwner) — pedido do usuário
// (2026-08-03): representante só vê/insere, não edita/remove.
export async function updateContactAction(
  companyId: string,
  contactId: string,
  data: { nome?: string; cargo?: string; email?: string; telefone?: string; decisor?: boolean },
): Promise<ActionResult<Contact>> {
  const token = await getServerAccessToken();
  try {
    const contact = await updateContact(token, companyId, contactId, data);
    revalidatePath("/dashboard/empresas");
    revalidatePath("/dashboard/leads");
    return { ok: true, data: contact };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function deleteContactAction(formData: FormData) {
  const token = await getServerAccessToken();
  const companyId = String(formData.get("companyId"));
  const contactId = String(formData.get("contactId"));
  const back = String(formData.get("back") ?? "/dashboard/empresas");

  try {
    await deleteContact(token, companyId, contactId);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/empresas");
  revalidatePath("/dashboard/leads");
  redirectWithMessage(back, "Contato removido");
}
