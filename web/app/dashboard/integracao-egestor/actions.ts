"use server";

import { revalidatePath } from "next/cache";
import { redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { getServerAccessToken } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import {
  completeEgestorContato,
  consolidateEgestorContato,
  correctEgestorContato,
  correctEgestorContatoCrm,
  correctEgestorContatoSefaz,
  promoteEgestorContatos,
  syncEgestorContatos,
  type CompletarContatoResult,
  type CorrecaoDirecao,
  type CorrigirContatoResult,
} from "@/lib/api/egestor";

const LISTA = "/dashboard/integracao-egestor";

// Síncrono de propósito, mesmo endpoint já usado via Postman/curl desde
// 2026-08-07 (docs/roadmap.md, item 8.3) — agora com botão na UI. Puxa
// ~45 páginas nas duas contas eGestor (throttle de 1.1s/req), pode levar
// dezenas de segundos: sem feedback de progresso nesta 1ª versão, só o
// resumo ao final.
export async function syncEgestorAction() {
  const token = await getServerAccessToken();

  let resumo;
  try {
    resumo = await syncEgestorContatos(token);
  } catch (error) {
    redirectWithError(LISTA, error);
  }

  revalidatePath(LISTA);
  redirectWithMessage(
    LISTA,
    `Sincronizado: ${resumo.total} contatos (${resumo.soMatriz} só Matriz, ${resumo.soFilial} só Filial, ${resumo.ambosIguais} iguais, ${resumo.ambosDiferentes} divergentes).`,
  );
}

export async function promoteEgestorAction() {
  const token = await getServerAccessToken();

  let resumo;
  try {
    resumo = await promoteEgestorContatos(token);
  } catch (error) {
    redirectWithError(LISTA, error);
  }

  revalidatePath(LISTA);
  revalidatePath("/dashboard/empresas");
  const erros = resumo.erros.length > 0 ? `, ${resumo.erros.length} erro(s)` : "";
  const estaduais =
    resumo.dadosEstaduaisAtualizados > 0
      ? `, ${resumo.dadosEstaduaisAtualizados} com dados estaduais atualizados`
      : "";
  redirectWithMessage(
    LISTA,
    `Promovidas ${resumo.promovidas} empresa(s) (${resumo.criadasNovas} novas, ${resumo.vinculadasExistente} vinculadas a cadastro existente), ${resumo.contatosCriados} contato(s) criado(s)${estaduais}${erros}.`,
  );
}

export type CorrectEgestorState =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

// Corrige a divergência gravando de volta no eGestor (docs/roadmap.md,
// item 9.6) — escreve num ERP de produção de terceiro, por isso o form
// (correct-form.tsx) pede confirmação explícita antes de chegar aqui.
//
// useActionState em vez de redirect() (bug corrigido em 2026-08-11,
// relatado pelo usuário: "confirmo, fecho a tela e nada acontece" — a
// causa é a mesma já documentada em 2026-08-01/02 pros 4 forms de
// criação: redirect() numa Server Action NÃO derruba o slot @modal de
// uma rota interceptada nesta versão do Next, então o modal fica preso
// mostrando o form antigo mesmo com a correção já aplicada no eGestor no
// servidor. Fix: devolve { ok, message } pro form fechar via
// router.back() (ver correct-form.tsx), mesmo padrão de
// createRawLeadAction/createCompanyAction etc.
export async function correctEgestorAction(
  _prevState: CorrectEgestorState,
  formData: FormData,
): Promise<CorrectEgestorState> {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const direcao = String(formData.get("direcao")) as CorrecaoDirecao;

  try {
    const data = await correctEgestorContato(token, id, direcao);
    revalidatePath(LISTA);
    return {
      ok: true,
      message: `Divergência corrigida no eGestor (${data.camposCorrigidos.length} campo${data.camposCorrigidos.length === 1 ? "" : "s"}).`,
    };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao corrigir divergência.") };
  }
}

// "Consolidar" (pedido do usuário, 2026-08-11) — une campos de lista
// divergentes (e-mails/telefones/tags/tipo) nos dois lados em vez de
// escolher uma direção só, como o "Corrigir" acima. Mesmo padrão
// useActionState (ver comentário em correctEgestorAction) pro modal
// fechar sozinho com router.back() só depois do backend confirmar.
export async function consolidarEgestorAction(
  _prevState: CorrectEgestorState,
  formData: FormData,
): Promise<CorrectEgestorState> {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    const data = await consolidateEgestorContato(token, id);
    revalidatePath(LISTA);
    return {
      ok: true,
      message: `Consolidado no eGestor (${data.camposCorrigidos.length} campo${data.camposCorrigidos.length === 1 ? "" : "s"} de lista unido${data.camposCorrigidos.length === 1 ? "" : "s"} nos dois lados).`,
    };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao consolidar no eGestor.") };
  }
}

// "Corrigir com SEFAZ" (pedido do usuário, 2026-08-11) — usa o cartão
// CNPJ (Receita Federal) como fonte em vez de escolher Matriz ou Filial.
// Mesmo padrão useActionState das outras duas ações acima. Sem campo
// extra no FormData (só `id`) — o backend consulta a Receita de novo por
// conta própria, não confia em dado vindo do client.
export async function corrigirEgestorSefazAction(
  _prevState: CorrectEgestorState,
  formData: FormData,
): Promise<CorrectEgestorState> {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    const data = await correctEgestorContatoSefaz(token, id);
    revalidatePath(LISTA);
    return {
      ok: true,
      message: `Corrigido com a Receita Federal (${data.camposCorrigidos.length} campo${data.camposCorrigidos.length === 1 ? "" : "s"}).`,
    };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao corrigir com a Receita Federal.") };
  }
}

// "Corrigir com CRM" (pedido do usuário, 2026-08-13, na esteira da
// sanitização em lote via cartão CNPJ — ver
// scripts/sanitizar-cadastros-cnpj.ts) — mesmo padrão useActionState de
// corrigirEgestorSefazAction acima, mas sem preview via fetch: o dado do
// CRM já vem pronto em `row.crm` (GET /contatos), o backend só confirma
// de novo por conta própria antes de gravar.
export async function corrigirEgestorCrmAction(
  _prevState: CorrectEgestorState,
  formData: FormData,
): Promise<CorrectEgestorState> {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    const data = await correctEgestorContatoCrm(token, id);
    revalidatePath(LISTA);
    return {
      ok: true,
      message: `Corrigido com o CRM (${data.camposCorrigidos.length} campo${data.camposCorrigidos.length === 1 ? "" : "s"}).`,
    };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao corrigir com o CRM.") };
  }
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

// Versões RPC de corrigir/completar — chamadas diretas (sem <form>, sem
// redirect) a partir do client component da tabela, mesmo padrão de
// bulkApproveLeadsAction/BulkEditModal em leads/actions.ts: a "edição em
// lote" (docs/roadmap.md, pedido do usuário 2026-08-10) roda um loop no
// client chamando uma dessas por item selecionado, porque cada chamada é
// uma escrita de verdade no eGestor (produção, de terceiro) que pode
// falhar individualmente — devolver { ok, data|message } por item deixa
// a tabela reportar sucesso/falha de cada linha, em vez de um redirect
// único que só serve pra ação isolada por linha.
export async function correctEgestorContatoRpc(
  id: string,
  direcao: CorrecaoDirecao,
): Promise<ActionResult<CorrigirContatoResult>> {
  const token = await getServerAccessToken();
  try {
    const data = await correctEgestorContato(token, id, direcao);
    revalidatePath(LISTA);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao corrigir divergência.") };
  }
}

export async function completeEgestorContatoRpc(
  id: string,
): Promise<ActionResult<CompletarContatoResult>> {
  const token = await getServerAccessToken();
  try {
    const data = await completeEgestorContato(token, id);
    revalidatePath(LISTA);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao completar Matriz/Filial.") };
  }
}
