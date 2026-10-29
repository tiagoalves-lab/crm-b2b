import { companyRazaoSocialName, formatPhoneBR } from "@/lib/api/companies";
import type { ContatoRelatorioRow, ContatosFiltro } from "@/lib/api/relatorios";
import type { Membership } from "@/lib/api/types";
import { formatDateBR } from "@/lib/format-date";
import { memberName } from "../(administracao)/membros/roles";
import { formatCnpj } from "../leads/cnpj-lookup-fields";
import { faixaDoPeriodo, PERIODOS, type Faixa } from "./periodo";

// Relatório "Contatos" (2026-09-28): a tela e o download do CSV
// (app/api/relatorios/contatos/route.ts) leem a MESMA querystring e montam
// as MESMAS colunas daqui — o arquivo baixado é exatamente o que a tela
// mostrou.

// Diferente dos outros relatórios, a data aqui é opcional: o padrão é a
// agenda inteira.
export const CADASTRO_QUALQUER = "";

export interface ContatosParams {
  cadastro: string;
  faixa: Faixa | null;
  usuarioId: string;
  decisor: string;
  empresa: string;
  contato: string;
}

export function lerParamsContatos(params: Record<string, string | undefined>): ContatosParams {
  const cadastro = PERIODOS.some((p) => p.valor === params.cadastro)
    ? (params.cadastro as string)
    : CADASTRO_QUALQUER;
  return {
    cadastro,
    faixa: cadastro
      ? faixaDoPeriodo(cadastro, { inicio: params.inicio, fim: params.fim })
      : null,
    usuarioId: params.usuarioId ?? "",
    decisor: params.decisor === "sim" || params.decisor === "nao" ? params.decisor : "",
    empresa: params.empresa ?? "",
    contato: params.contato ?? "",
  };
}

export function filtroContatos(p: ContatosParams): ContatosFiltro {
  return {
    inicio: p.faixa?.inicio,
    fim: p.faixa?.fim,
    usuarioId: p.usuarioId || undefined,
    decisor: (p.decisor || undefined) as ContatosFiltro["decisor"],
    empresa: p.empresa.trim() || undefined,
    contato: p.contato.trim() || undefined,
  };
}

export const COLUNAS_CONTATOS = [
  "Empresa",
  "CNPJ/CPF",
  "Contato",
  "Cargo",
  "Telefone",
  "E-mail",
  "Decisor",
  "Responsável",
  "Cadastrado em",
] as const;

// Uma linha já no texto final, na ordem de COLUNAS_CONTATOS.
export function linhaContato(row: ContatoRelatorioRow, memberships: Membership[]): string[] {
  const dono = row.ownerUserId
    ? memberships.find((m) => m.userId === row.ownerUserId)
    : undefined;
  return [
    row.company ? companyRazaoSocialName(row.company) : "",
    row.company?.cpfCnpj ? formatCnpj(row.company.cpfCnpj) : "",
    row.nome,
    row.cargo ?? "",
    formatPhoneBR(row.telefone) ?? "",
    row.email ?? "",
    row.decisor ? "Sim" : "Não",
    dono ? memberName(dono) : "",
    formatDateBR(row.createdAt),
  ];
}
