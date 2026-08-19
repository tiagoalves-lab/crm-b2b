// A Receita Federal concatena "EM RECUPERAÇÃO JUDICIAL" (Lei
// 11.101/2005) ao final da razão social de empresas nessa situação — não
// é um campo próprio, é texto corrido dentro do mesmo campo que a
// company/lead usa como nome. Sem tratar isso, o aviso "passa
// despercebido" dentro do nome em qualquer tela/lista/proposta comercial
// (pedido direto do usuário, 2026-08-05) — em vez de escondido no meio do
// texto, extraído pra um indicador explícito
// (Company.emRecuperacaoJudicial / RawLead.emRecuperacaoJudicial) e
// removido do texto que sobra (que passa a ser só o nome de cadastro).
//
// Acento/caixa não importam: `[CÇ]`/`[AÃ]` cobre RECUPERACAO e
// RECUPERAÇÃO, a flag `i` cobre maiúscula/minúscula. Separador opcional
// antes (espaço/hífen/travessão/vírgula/parênteses) e fechamento de
// parênteses/pontuação opcional depois — a Receita sempre anexa isso no
// FINAL da razão social, nunca no meio, por isso o `$` de âncora.
const EM_RECUPERACAO_JUDICIAL_RE =
  /[\s,;:()\-–—]*EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL\)?[\s,;:()\-–—]*$/i;

export interface SanitizedRazaoSocial {
  razaoSocial: string;
  emRecuperacaoJudicial: boolean;
}

export function sanitizeRazaoSocial(raw: string): SanitizedRazaoSocial {
  const trimmed = raw.trim();
  if (!EM_RECUPERACAO_JUDICIAL_RE.test(trimmed)) {
    return { razaoSocial: trimmed, emRecuperacaoJudicial: false };
  }
  const cleaned = trimmed.replace(EM_RECUPERACAO_JUDICIAL_RE, '').trim();
  // Se sobrar vazio (nome era só o aviso, sem nome de cadastro nenhum
  // antes dele — não deveria acontecer na prática), mantém o texto
  // original em vez de zerar o nome da empresa.
  return { razaoSocial: cleaned || trimmed, emRecuperacaoJudicial: true };
}

// Usado onde o chamador já pode ter detectado o indicador mais cedo (ex.:
// CompanyService#lookupCnpj, que sanitiza a razão social direto na
// resposta da consulta de CNPJ pra já devolver o texto limpo pro
// frontend) — se `hint` vier definido, confia nele em vez de tentar
// detectar de novo a partir de um texto que essa altura já pode estar
// limpo (o que daria falso negativo). Sem hint, cai no autodetect normal
// — cobre entrada manual (usuário digitou o aviso à mão) e qualquer
// import que nunca passou por uma sanitização anterior (planilha do
// crawler, cujo texto chega sempre bruto da Receita).
export function resolveRazaoSocial(
  razaoSocial: string,
  hint?: boolean,
): SanitizedRazaoSocial {
  if (hint !== undefined) {
    return { razaoSocial: razaoSocial.trim(), emRecuperacaoJudicial: hint };
  }
  return sanitizeRazaoSocial(razaoSocial);
}
