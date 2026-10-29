import { apiFetch } from "./client";

// Console fiscal (2026-10-20, docs/console-fiscal.md). Ler exige a
// permissão "fiscal" (o backend responde 403 sem ela); atualizar as notas
// é só owner/admin. Valores monetários chegam como texto ("1234.56") —
// é como o Postgres devolve decimal, sem passar por float.

export interface StatusCarga {
  emAndamento: boolean;
  etapa: string | null;
  processadas: number;
  total: number;
  iniciadaEm: string | null;
  ultima: {
    desde: string;
    ate: string;
    concluidaEm: string;
    falhas: { estabelecimento: string; tipo: string; codEgestor: number; numero: number | null; motivo: string }[];
  } | null;
  erro: string | null;
}

// Relatório "Resumo de notas emitidas": NF-e com CFOP de receita + NFS-e.
export interface LinhaReceita {
  id: string;
  estabelecimento: "matriz" | "filial";
  tipo: "produto" | "servico";
  numero: number | null;
  destinatario: string | null;
  dataEmissao: string;
  situacao: string;
  // Natureza da operação; NFS-e vem como "Prestação de serviço".
  operacao: string | null;
  total: string | null;
  vIcms: string | null;
  vIpi: string | null;
  // Só NFS-e.
  vIss: string | null;
  vPis: string | null;
  vCofins: string | null;
  cfopMisto: boolean;
}

export interface TotalReceita {
  // null = total geral
  tipo: "produto" | "servico" | null;
  notas: number;
  total: string;
  // null = o imposto não se aplica a nenhuma nota somada
  vIcms: string | null;
  vIpi: string | null;
  vIss: string | null;
  vPis: string;
  vCofins: string;
}

export interface RelatorioReceita {
  inicio: string;
  fim: string;
  rows: LinhaReceita[];
  truncado: boolean;
  totais: TotalReceita[];
  // Operações das notas do período com os outros filtros (opções do filtro).
  operacoes: string[];
}

export function getRelatorioReceita(
  token: string,
  filtro: {
    inicio: string;
    fim: string;
    estabelecimento?: string;
    tipo?: string;
    situacao?: string;
    notas?: string;
    operacao?: string;
  },
): Promise<RelatorioReceita> {
  const query = new URLSearchParams({ inicio: filtro.inicio, fim: filtro.fim });
  if (filtro.estabelecimento) query.set("estabelecimento", filtro.estabelecimento);
  if (filtro.tipo) query.set("tipo", filtro.tipo);
  if (filtro.situacao) query.set("situacao", filtro.situacao);
  if (filtro.notas) query.set("notas", filtro.notas);
  if (filtro.operacao) query.set("operacao", filtro.operacao);
  return apiFetch(`/fiscal/relatorio-receita?${query.toString()}`, { token });
}

// Controle de remessas (docs/console-fiscal.md, 7.4 e 7.5).
export interface RetornoDaRemessa {
  chave: string;
  numero: number | null;
  dataEmissao: string;
  cfops: string[];
  // itens do CFOP de retorno, na ordem da nota ("2 × PRODUTO")
  itens: string[];
  valor: string;
  // nota = o retorno cita a remessa no XML; manual = ligado à mão na tela
  origem: "nota" | "manual";
  // false = entrou pela descrição da nota, o CFOP não é de retorno
  cfopConfere: boolean;
  // CNPJ/CPF de quem está do outro lado da nota
  documento: string | null;
}

export type SituacaoRetorno = "retornada" | "parcial" | "aberta";

export interface LinhaRemessa {
  id: string;
  chave: string;
  // enviada = a Gama mandou e tem que voltar; recebida = terceiro mandou e
  // a Gama tem que devolver
  lado: "enviada" | "recebida";
  estabelecimento: "matriz" | "filial";
  numero: number | null;
  dataEmissao: string;
  contraparte: string | null;
  documento: string | null;
  // false = entrou pela descrição da nota, o CFOP não é de remessa
  cfopConfere: boolean;
  // nota da Gama com CFOP que conta como receita (PIS/COFINS)
  receita: boolean;
  cfops: string[];
  natureza: string | null;
  // itens do CFOP que exige retorno, na ordem da nota ("2 × PRODUTO")
  itens: string[];
  valor: string;
  valorRetornado: string;
  retorno: SituacaoRetorno;
  diasEmAberto: number | null;
  retornos: RetornoDaRemessa[];
}

export interface ResumoRemessas {
  lado: "enviada" | "recebida";
  retorno: SituacaoRetorno;
  remessas: number;
  valor: string;
}

// Nota de retorno pra arrastar até a remessa (coluna da direita).
export interface RetornoDisponivel {
  chave: string;
  // que lado de remessa ela fecha
  fecha: "enviada" | "recebida";
  estabelecimento: "matriz" | "filial";
  numero: number | null;
  dataEmissao: string;
  contraparte: string | null;
  documento: string | null;
  cfopConfere: boolean;
  cfops: string[];
  itens: string[];
  valor: string;
  // quantas remessas ela já fecha (um retorno pode cobrir várias)
  vinculos: number;
}

export interface ControleRemessas {
  inicio: string;
  fim: string;
  rows: LinhaRemessa[];
  truncado: boolean;
  resumo: ResumoRemessas[];
  retornos: RetornoDisponivel[];
  // log dos alertas das remessas da lista, do mais antigo pro mais novo
  alertasLog: RegistroAlerta[];
}

// Registro do log de alertas (decisão 7.7): o último de cada remessa +
// regra diz se o alerta está tratado.
export interface RegistroAlerta {
  remessaChave: string;
  regra: string;
  acao: "tratar" | "reabrir";
  observacao: string | null;
  autor: string;
  criadoEm: string;
}

export interface VinculoRemessa {
  remessaChave: string;
  retornoChave: string;
}

export function vincularRetorno(token: string, vinculo: VinculoRemessa): Promise<{ ok: true }> {
  return apiFetch("/fiscal/remessas/vinculos", { method: "POST", token, body: vinculo });
}

export function desvincularRetorno(token: string, vinculo: VinculoRemessa): Promise<{ ok: true }> {
  return apiFetch("/fiscal/remessas/vinculos/desfazer", { method: "POST", token, body: vinculo });
}

// Alerta do Controle de remessas tratado / reaberto (decisão 7.7).
export interface AlertaRemessa {
  remessaChave: string;
  // código da regra no acervo (alertas-remessa.ts)
  regra: string;
  observacao?: string;
}

export function tratarAlerta(token: string, alerta: AlertaRemessa): Promise<{ ok: true }> {
  return apiFetch("/fiscal/remessas/alertas/tratar", { method: "POST", token, body: alerta });
}

export function reabrirAlerta(token: string, alerta: AlertaRemessa): Promise<{ ok: true }> {
  return apiFetch("/fiscal/remessas/alertas/reabrir", { method: "POST", token, body: alerta });
}

export function getRemessas(
  token: string,
  filtro: { inicio: string; fim: string; estabelecimento?: string; lado?: string; retorno?: string },
): Promise<ControleRemessas> {
  const query = new URLSearchParams({ inicio: filtro.inicio, fim: filtro.fim });
  if (filtro.estabelecimento) query.set("estabelecimento", filtro.estabelecimento);
  if (filtro.lado) query.set("lado", filtro.lado);
  if (filtro.retorno) query.set("retorno", filtro.retorno);
  return apiFetch(`/fiscal/remessas?${query.toString()}`, { token });
}

export function getStatusCarga(token: string): Promise<StatusCarga> {
  return apiFetch("/fiscal/sync/status", { token, timeoutMs: 15_000 });
}

export function iniciarCargaEmitidas(token: string): Promise<StatusCarga> {
  return apiFetch("/fiscal/sync/emitidas", { method: "POST", token, timeoutMs: 15_000 });
}

// Notas de entrada (decisão 7.8): NF-e recebidas e NF-e de entrada da
// própria Gama, com a classificação de cada item.
export type ClasseEntrada =
  | "revenda"
  | "industrializacao"
  | "mat-aplic-servico"
  | "imobilizado"
  | "uso-consumo"
  | "viagem"
  | "remessa"
  | "retorno"
  | "transferencia"
  | "devolucao"
  | "icms"
  | "cancelada"
  | "desconhecimento";

export interface ItemEntrada {
  nItem: number;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  quantidade: string | null;
  valor: string | null;
  bcIcms: string | null;
  pIcms: string | null;
  vIcms: string | null;
  pIpi: string | null;
  vIpi: string | null;
  classe: ClasseEntrada | null;
  sugestao: ClasseEntrada | null;
  sugestaoMotivo: "cfop" | "fornecedor" | null;
}

export interface NotaEntrada {
  chave: string;
  fonte: "recebida" | "propria";
  estabelecimento: "matriz" | "filial";
  numero: number | null;
  dataEmissao: string;
  natureza: string | null;
  fornecedor: string | null;
  documento: string | null;
  uf: string | null;
  valor: string | null;
  vIcms: string | null;
  vIpi: string | null;
  // sim/nao = lançada como compra no eGestor; propria = emitida pela Gama
  lancamento: "sim" | "nao" | "propria";
  itens: ItemEntrada[];
}

export interface RegistroClassificacao {
  chave: string;
  nItem: number;
  classe: ClasseEntrada | null;
  observacao: string | null;
  origem: "tela" | "planilha";
  autor: string;
  criadoEm: string;
}

export interface NotasEntrada {
  inicio: string;
  fim: string;
  truncado: boolean;
  rows: NotaEntrada[];
  // do mais antigo pro mais novo
  historico: RegistroClassificacao[];
}

export function getEntradas(
  token: string,
  filtro: { inicio: string; fim: string; estabelecimento?: string },
): Promise<NotasEntrada> {
  const query = new URLSearchParams({ inicio: filtro.inicio, fim: filtro.fim });
  if (filtro.estabelecimento) query.set("estabelecimento", filtro.estabelecimento);
  return apiFetch(`/fiscal/entradas?${query.toString()}`, { token });
}

// Sem `itens`, vale pra todos os itens da nota; classe nula retira.
export interface ClassificacaoEntrada {
  chave: string;
  itens?: number[];
  classe: ClasseEntrada | null;
  observacao?: string;
}

export function classificarEntrada(
  token: string,
  dados: ClassificacaoEntrada,
): Promise<{ ok: true; alterados: number }> {
  return apiFetch("/fiscal/entradas/classificar", { method: "POST", token, body: dados });
}

// Consultar notas (2026-10-28): pesquisa livre em todas as notas —
// emitidas, recebidas e NFS-e. Os filtros chegam com os mesmos nomes da
// querystring da tela e vão direto pro backend.
export type VisaoConsulta = "nota" | "item" | "empresa" | "cfop" | "mes";

export interface ResumoConsulta {
  notas: number;
  foraDaSoma: number;
  notasSaida: number;
  saida: string;
  notasEntrada: number;
  entrada: string;
  vIcms: string;
  vIpi: string;
  vPis: string;
  vCofins: string;
  total: string;
}

// "Origem" (sentido) é sempre do lado da Gama: a venda do fornecedor é
// entrada aqui.
export interface ConsultaNota {
  id: string;
  doc: "nfe" | "nfse";
  emitente: "gama" | "terceiro";
  estabelecimento: "matriz" | "filial";
  chave: string | null;
  numero: number | null;
  serie: string | null;
  dataEmissao: string;
  situacao: string;
  resumo: boolean;
  sentido: "entrada" | "saida" | null;
  natureza: string | null;
  empresa: string | null;
  documento: string | null;
  uf: string | null;
  transferencia: boolean;
  cfops: string | null;
  itens: number;
  primeiroItem: string | null;
  total: string | null;
  vIcms: string | null;
  vIpi: string | null;
  vPis: string | null;
  vCofins: string | null;
  vIss: string | null;
}

export interface ConsultaItem {
  notaId: string;
  doc: "nfe" | "nfse";
  emitente: "gama" | "terceiro";
  estabelecimento: "matriz" | "filial";
  numero: number | null;
  dataEmissao: string;
  situacao: string;
  sentido: "entrada" | "saida" | null;
  empresa: string | null;
  documento: string | null;
  nItem: number;
  codigo: string | null;
  descricao: string | null;
  ncm: string | null;
  // código da lista de serviços (só NFS-e)
  servico: string | null;
  cfop: string | null;
  cfopDescricao: string | null;
  // origem da mercadoria (1º dígito do CST)
  origem: string | null;
  cst: string | null;
  quantidade: string | null;
  valor: string | null;
  bcIcms: string | null;
  pIcms: string | null;
  vIcms: string | null;
  pIpi: string | null;
  vIpi: string | null;
}

export interface ConsultaEmpresa {
  empresa: string | null;
  documento: string | null;
  uf: string | null;
  notas: number;
  saida: string;
  entrada: string;
  vIcms: string | null;
  vIpi: string | null;
  vPis: string;
  vCofins: string;
}

export interface ConsultaCfop {
  cfop: string | null;
  descricao: string | null;
  notas: number;
  itens: number;
  valor: string;
  vIcms: string | null;
  vIpi: string | null;
}

export interface ConsultaMes {
  mes: string;
  notas: number;
  saida: string;
  entrada: string;
  vIcms: string | null;
  vIpi: string | null;
  vPis: string;
  vCofins: string;
}

export interface ConsultaNotas {
  inicio: string;
  fim: string;
  ver: VisaoConsulta;
  resumo: ResumoConsulta;
  // Só na visão por item: soma dos itens que contam.
  totalItens: { itens: string; valor: string; bcIcms: string; vIcms: string; vIpi: string } | null;
  truncado: boolean;
  rows: (ConsultaNota | ConsultaItem | ConsultaEmpresa | ConsultaCfop | ConsultaMes)[];
}

export function getConsultaNotas(token: string, filtro: Record<string, string>): Promise<ConsultaNotas> {
  return apiFetch(`/fiscal/consulta?${new URLSearchParams(filtro).toString()}`, { token });
}
