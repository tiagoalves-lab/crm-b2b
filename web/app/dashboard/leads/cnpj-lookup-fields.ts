import type { CnpjLookupResult } from "@/lib/api/companies";

// Tradução do retorno da busca por CNPJ (BrasilAPI via /api/cnpj) pros
// campos de cadastro do lead — compartilhada entre o form "Novo lead"
// (lead-form.tsx) e o editor de CNPJ da ficha (lead-cnpj-editor.tsx), que
// completa um lead já em triagem (o do formulário do Meta chega sem CNPJ,
// 2026-09-04). Uma regra só pros dois lugares.

export const PORTES = ["GRANDE", "MÉDIO", "PEQUENO"];
export const SITUACOES = ["ATIVA", "BAIXADA", "SUSPENSA", "INAPTA", "NULA"];

// lookupCnpj (company.service.ts) devolve o CNAE já como "código -
// descrição" numa string só (mesmo texto do card da Receita na ficha de
// empresa) — aqui precisa separar em dois campos porque RawLead guarda
// cnaePrincipal/cnaeDescricao à parte.
export function splitCnae(combined?: string): { codigo: string; descricao: string } {
  if (!combined) return { codigo: "", descricao: "" };
  const idx = combined.indexOf(" - ");
  if (idx === -1) return { codigo: combined, descricao: "" };
  return { codigo: combined.slice(0, idx), descricao: combined.slice(idx + 3) };
}

// Espelha o normalizePorte do backend (spreadsheet-import.util.ts) — a
// Receita devolve texto livre ("DEMAIS", "MICRO EMPRESA", "EMPRESA DE
// PEQUENO PORTE"), e o <select> aqui só tem as 3 faixas que o
// LeadScoringService reconhece.
export function normalizePorte(raw?: string): string {
  const upper = (raw ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  if (!upper) return "";
  if (upper === "EPP" || upper.includes("PEQUENO") || upper.includes("MICRO")) return "PEQUENO";
  if (upper === "DEMAIS") return "MÉDIO";
  if (upper === "GRANDE") return "GRANDE";
  if (upper === "MEDIO") return "MÉDIO";
  return "";
}

export function normalizeSituacao(raw?: string): string {
  const upper = (raw ?? "").trim().toUpperCase();
  return SITUACOES.includes(upper) ? upper : "ATIVA";
}

// O que a busca devolve, já no formato que o backend grava (caixa alta nos
// campos de texto, mesmo padrão de RawLeadService#upperCaseTextFields).
export interface CadastroFromLookup {
  cnpj: string;
  razaoSocial?: string;
  emRecuperacaoJudicial: boolean;
  cnaePrincipal?: string;
  cnaeDescricao?: string;
  porte?: string;
  situacao: string;
  uf?: string;
  municipio?: string;
}

export function cadastroFromLookup(data: CnpjLookupResult): CadastroFromLookup {
  const cnae = splitCnae(data.cnaePrincipal);
  const porte = normalizePorte(data.porte);
  return {
    cnpj: data.cpfCnpj,
    razaoSocial: data.razaoSocial?.toUpperCase() || undefined,
    emRecuperacaoJudicial: data.emRecuperacaoJudicial,
    cnaePrincipal: cnae.codigo ? cnae.codigo.toUpperCase() : undefined,
    cnaeDescricao: cnae.descricao ? cnae.descricao.toUpperCase() : undefined,
    porte: porte || undefined,
    situacao: normalizeSituacao(data.situacaoCadastral),
    uf: data.uf?.toUpperCase() || undefined,
    municipio: data.cidade?.toUpperCase() || undefined,
  };
}

// 12.345.678/0001-95 — só pra exibição; o banco guarda os 14 dígitos.
export function formatCnpj(digits: string | null | undefined): string {
  const d = (digits ?? "").replace(/\D/g, "");
  if (d.length !== 14) return digits ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
