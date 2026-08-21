import { apiFetch } from "./client";
import type { EgestorContatoConsolidado, EgestorContatoStatus, EgestorInteractionLog } from "./types";

// Relatório de auditoria — GET /integrations/egestor/contatos, só
// owner/admin (backend rejeita com 403 os demais papéis). Sem paginação
// de verdade (~300 linhas no volume atual) — mesmo critério já usado em
// Empresas/Prospecção: busca tudo, filtra/ordena no client.
export function listEgestorContatos(
  token: string,
  filtro?: { status?: EgestorContatoStatus },
): Promise<EgestorContatoConsolidado[]> {
  const qs = filtro?.status ? `?status=${filtro.status}` : "";
  return apiFetch<EgestorContatoConsolidado[]>(`/integrations/egestor/contatos${qs}`, { token });
}

// Sem endpoint de detalhe dedicado no backend — a tela de correção reusa
// a mesma lista (~300 linhas, já sem paginação de verdade) e procura pelo
// id, mesmo critério de "fetch tudo" já usado no relatório em si.
export async function getEgestorContato(
  token: string,
  id: string,
): Promise<EgestorContatoConsolidado | undefined> {
  const rows = await listEgestorContatos(token);
  return rows.find((r) => r.id === id);
}

export interface SyncContatosResult {
  totalMatriz: number;
  totalFilial: number;
  clientesMatriz: number;
  clientesFilial: number;
  semCnpjIgnorados: number;
  total: number;
  soMatriz: number;
  soFilial: number;
  ambosIguais: number;
  ambosDiferentes: number;
}

export function syncEgestorContatos(token: string): Promise<SyncContatosResult> {
  return apiFetch<SyncContatosResult>("/integrations/egestor/sync/contatos", {
    method: "POST",
    token,
  });
}

export interface PromoteContatosResult {
  promovidas: number;
  vinculadasExistente: number;
  criadasNovas: number;
  usandoDadosDivergentes: number;
  contatosCriados: number;
  // Fichas que ganharam inscrição estadual / indicador de IE vindos do
  // eGestor nesta rodada (2026-08-19).
  dadosEstaduaisAtualizados: number;
  erros: Array<{ cpfCnpj: string; motivo: string }>;
}

export function promoteEgestorContatos(token: string): Promise<PromoteContatosResult> {
  return apiFetch<PromoteContatosResult>("/integrations/egestor/promover-contatos", {
    method: "POST",
    token,
  });
}

export type CorrecaoDirecao = "matriz_para_filial" | "filial_para_matriz";

export interface CorrigirContatoResult {
  camposCorrigidos: string[];
  statusFinal: EgestorContatoStatus;
}

// Corrige uma divergência Matriz×Filial gravando de volta no eGestor via
// PUT (docs/roadmap.md, item 9.6). `direcao` decide qual lado é a fonte —
// "matriz_para_filial" copia o dado da Matriz por cima da Filial.
export function correctEgestorContato(
  token: string,
  id: string,
  direcao: CorrecaoDirecao,
): Promise<CorrigirContatoResult> {
  return apiFetch<CorrigirContatoResult>(`/integrations/egestor/contatos/${id}/corrigir`, {
    method: "POST",
    token,
    body: { direcao },
  });
}

export interface CompletarContatoResult {
  statusFinal: EgestorContatoStatus;
}

// "Completar Matriz ⇄ Filial" (docs/roadmap.md, item 9.9) — pro caso
// so_matriz/so_filial: cria o contato que falta na conta ausente, usando
// os dados do lado que já existe. Sem escolha de direção (diferente de
// correctEgestorContato) — a direção é a própria situação da linha.
export function completeEgestorContato(
  token: string,
  id: string,
): Promise<CompletarContatoResult> {
  return apiFetch<CompletarContatoResult>(`/integrations/egestor/contatos/${id}/completar`, {
    method: "POST",
    token,
  });
}

export interface ConsolidarContatoResult {
  camposCorrigidos: string[];
  statusFinal: EgestorContatoStatus;
}

// "Consolidar" (pedido do usuário, 2026-08-11) — une os campos de LISTA
// divergentes (e-mails/telefones/tags/tipo) nos dois lados em vez de
// escolher um lado pra sobrescrever o outro (isso é correctEgestorContato
// acima). Sem escolha de direção/campo — o backend decide sozinho quais
// dos campos divergentes da linha são de lista e consolida só esses.
export function consolidateEgestorContato(
  token: string,
  id: string,
): Promise<ConsolidarContatoResult> {
  return apiFetch<ConsolidarContatoResult>(`/integrations/egestor/contatos/${id}/consolidar`, {
    method: "POST",
    token,
  });
}

// "Corrigir com SEFAZ" (pedido do usuário, 2026-08-11) — usa o cartão
// CNPJ (Receita Federal, mesma fonte de lookupCnpj em companies.ts — não
// SEFAZ de verdade, ver comentário de CAMPOS_SEFAZ no backend) como fonte
// em vez de Matriz/Filial. Sem body: o backend consulta a Receita de
// novo por conta própria (o botão "Consultar SEFAZ" da tela é só
// pré-visualização, nunca manda o dado consultado de volta) e decide
// sozinho se precisa corrigir Matriz, Filial ou os dois.
export function correctEgestorContatoSefaz(
  token: string,
  id: string,
): Promise<ConsolidarContatoResult> {
  return apiFetch<ConsolidarContatoResult>(`/integrations/egestor/contatos/${id}/corrigir-sefaz`, {
    method: "POST",
    token,
  });
}

// "Corrigir com CRM" (pedido do usuário, 2026-08-13) — mesmo mecanismo de
// correctEgestorContatoSefaz acima, mas a fonte é o cadastro que já está
// em `companies` (mesmo CNPJ), não uma consulta nova à Receita. Sem body
// — o preview já vem pronto em `row.crm` (GET /contatos já traz, ver
// listEgestorContatos), não precisa de um botão "Consultar" separado.
export function correctEgestorContatoCrm(
  token: string,
  id: string,
): Promise<ConsolidarContatoResult> {
  return apiFetch<ConsolidarContatoResult>(`/integrations/egestor/contatos/${id}/corrigir-crm`, {
    method: "POST",
    token,
  });
}

export type PropagarCompanyResult =
  | { propagado: true; campos: string[]; lados: string[] }
  | { propagado: false; motivo: string };

// Propagação CRM → eGestor ao salvar a ficha da empresa (decisão do
// usuário, 2026-08-14). Chamada DEPOIS do save, nunca antes — o cadastro
// no CRM é o que manda aqui, e a propagação é consequência dele.
// Nunca lança por "não havia o que propagar" (empresa sem vínculo com o
// eGestor, dados já iguais): esses casos voltam como `propagado: false`
// com motivo, pra ação da ficha reportar sem parecer que o save falhou.
export function propagarCompanyParaEgestor(
  token: string,
  companyId: string,
): Promise<PropagarCompanyResult> {
  return apiFetch<PropagarCompanyResult>(
    `/integrations/egestor/companies/${companyId}/propagar`,
    { method: "POST", token },
  );
}

// Histórico legível de interações (docs/roadmap.md, "Criar log das
// interações de requisições de API", 2026-08-13) — botão "Histórico de
// requisições" na tela Integração eGestor. Sem paginação de verdade (mesmo
// critério do resto do módulo), já vem ordenado do mais recente pro mais
// antigo.
export function listEgestorInteractionLog(token: string): Promise<EgestorInteractionLog[]> {
  return apiFetch<EgestorInteractionLog[]>("/integrations/egestor/interaction-log", { token });
}

// Carga do histórico de vendas das duas contas (raia "Vendas histórico")
// — alimenta LTV/última compra/aba Pós-venda. Só owner/admin; o backend
// rejeita os demais papéis com 403.
export interface SyncVendasResult {
  totalMatriz: number;
  totalFilial: number;
  descartadas: number;
  vendedoresSemMembro: string[];
  gravadas: number;
  novas: number;
  removidas: number;
  orfas: number;
  orfasCodContatos: string[];
  empresasComVenda: number;
  semVendedorVinculado: number;
}

export function syncEgestorVendas(token: string): Promise<SyncVendasResult> {
  return apiFetch<SyncVendasResult>("/integrations/egestor/sync/vendas", {
    method: "POST",
    token,
  });
}
