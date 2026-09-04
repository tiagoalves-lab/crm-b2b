import { apiFetch } from "./client";
import type { Company, PaginatedResult, PessoaTipo } from "./types";

// Company não guarda mais um "nome" próprio (coluna removida em
// 2026-08-01, decisão do usuário — era redundante com razão
// social/fantasia, que já cobriam o mesmo caso de uso e ainda por cima
// preenchem sozinhos via busca de CNPJ). Todo lugar que exibia
// company.name passa a chamar isto — mesma ordem de prioridade usada na
// migration pra view v_busca_empresa_lead (fantasia > razão social >
// nome pra contato), pra bater com o que a busca de empresa/lead mostra.
export function companyDisplayName(
  company: Pick<Company, "fantasia" | "razaoSocial" | "nomeParaContato">,
): string {
  return (
    company.fantasia?.trim() ||
    company.razaoSocial?.trim() ||
    company.nomeParaContato?.trim() ||
    "Empresa sem nome"
  );
}

// Prioriza razão social (igual ao protótipo, clienteRows() usa c.razao) —
// usado onde a coluna precisa mostrar a razão social em vez da fantasia,
// caindo pra companyDisplayName só se a empresa não tiver razão social
// cadastrada (ex.: criada só com fantasia). Extraído de empresas-table.tsx
// em 2026-08-11 pra ser reusado no Painel comercial (Ações da semana).
export function companyRazaoSocialName(
  company: Pick<Company, "fantasia" | "razaoSocial" | "nomeParaContato">,
): string {
  return company.razaoSocial?.trim() || companyDisplayName(company);
}

// Telefone chega do banco só com dígitos (import antigo não normalizou
// pontuação). Formata só quando bate DDD+número (10 ou 11 dígitos) — pra
// entrada fora desse padrão (dado sujo de importação), devolve como veio em
// vez de arriscar formatar errado.
export function formatPhoneBR(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

// Busca TODAS as páginas, não só a 1ª — `GET /companies` limita
// `pageSize` a 100 (ListQueryDto, `@Max(100)`), e esta função sempre
// pediu só uma página com esse teto. Enquanto o total de empresas ficou
// abaixo de 100, nunca deu pra notar — passou a truncar de verdade a
// partir da promoção de 213 clientes do eGestor (2026-08-07,
// docs/roadmap.md), escondendo empresa real da tela
// sem nenhum aviso (a contagem "X de Y" também vinha errada, calculada
// em cima da mesma lista já truncada). Todo chamador (empresas, sidebar,
// painel, pipeline, tarefas) depende de ter a lista completa pra
// contagem/busca/resolução de nome bater — por isso o fix é aqui, uma
// vez, não em cada tela.
export async function listCompanies(
  token: string,
  includeDeleted = false,
): Promise<PaginatedResult<Company>> {
  const pageSize = 100;
  const fetchPage = (page: number) => {
    const query = new URLSearchParams({ pageSize: String(pageSize), page: String(page) });
    if (includeDeleted) query.set("includeDeleted", "true");
    return apiFetch<PaginatedResult<Company>>(`/companies?${query.toString()}`, { token });
  };

  // A 1ª página diz o total; as demais vão todas de uma vez (2026-09-03 —
  // antes eram sequenciais, ~300 ms cada, em toda tela que rotula empresa).
  const first = await fetchPage(1);
  const totalPages = Math.max(1, Math.ceil(first.total / pageSize));
  const rest =
    totalPages > 1
      ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2)))
      : [];
  const items = first.items.concat(...rest.map((r) => r.items));

  return { items, total: first.total, page: 1, pageSize: items.length };
}

// Uma linha da tela de Empresas, montada pelo backend (2026-09-04).
// A tela antes precisava de 6 requisições pra isto: as 4 páginas de
// listCompanies (com endereço, e-mails, telefones e campos extras que a
// tabela nem mostra), mais as listas inteiras de oportunidades e de
// vendas (1.093 linhas) só pra somar LTV e achar a última compra. Agora é
// uma requisição, com as somas feitas pelo banco.
export interface CompanyResumo {
  id: string;
  razaoSocial: string | null;
  fantasia: string | null;
  nomeParaContato: string | null;
  cpfCnpj: string | null;
  cidade: string | null;
  uf: string | null;
  tags: string[];
  curvaAbc: "A" | "B" | "C" | null;
  curvaAbcCalculadaEm: string | null;
  deletedAt: string | null;
  temEgestor: boolean;
  ltv: number;
  // Zerados (0 / null) quando o usuário não tem permissão de ver vendas —
  // o backend omite o faturamento em vez de recusar a lista inteira.
  ultimaCompra: string | null;
}

export function listCompaniesResumo(
  token: string,
  includeDeleted = false,
): Promise<{ items: CompanyResumo[]; total: number }> {
  const query = includeDeleted ? "?includeDeleted=true" : "";
  return apiFetch<{ items: CompanyResumo[]; total: number }>(
    `/companies/resumo${query}`,
    { token },
  );
}

export interface CreateCompanyInput {
  domain?: string;
  industry?: string;
  size?: string;
  razaoSocial?: string;
  // Advisory — quando já sabido (ex.: veio de CnpjLookupResult), repassa
  // pro backend confiar direto em vez de redetectar a partir de um texto
  // que já pode estar limpo (ver CreateCompanyDto#emRecuperacaoJudicial).
  emRecuperacaoJudicial?: boolean;
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
  // Já detectado e removido de razaoSocial pelo backend (ver
  // src/companies/company.service.ts#lookupCnpj) — repassar direto pra
  // createCompany/updateCompany em vez de deixar o backend redetectar.
  emRecuperacaoJudicial: boolean;
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
  situacaoCadastral?: string;
  dataAbertura?: string;
  porte?: string;
  naturezaJuridica?: string;
  cnaePrincipal?: string;
  cnaeSecundarios?: string[];
  estabelecimento?: string;
}

// Extrai só dígitos antes de montar a URL — o valor pode vir com pontuação
// (ex. "12.345.678/0001-99" digitado direto no campo CPF/CNPJ da empresa,
// reusado como defaultValue em refreshCnpjDataAction). Sem isso, uma "/"
// no meio do CNPJ quebra o roteamento do Nest (vira 2 segmentos de URL em
// vez de 1 param) e o pedido nem chega no backend — 404 "Cannot GET...".
export function lookupCnpj(
  token: string,
  cnpj: string,
): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, "");
  return apiFetch<CnpjLookupResult>(`/companies/cnpj/${digits}`, { token });
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

// Recalcula a curva ABC de todos os clientes e grava a classe em cada
// empresa. Só owner/admin (o backend rejeita os demais com 403) — é uma
// reclassificação da carteira inteira, não uma edição de registro.
export interface CurvaAbcResumo {
  classificadas: number;
  a: number;
  b: number;
  c: number;
  semCompra: number;
  faturamentoTotal: string;
  calculadaEm: string;
}

export function calcularCurvaAbc(token: string): Promise<CurvaAbcResumo> {
  return apiFetch<CurvaAbcResumo>("/companies/curva-abc/calcular", {
    method: "POST",
    token,
  });
}
