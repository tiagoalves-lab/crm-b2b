import type { LinhaRemessa, RegistroAlerta } from "@/lib/api/fiscal";

// Acervo de regras de validação do Controle de remessas (pedido do
// usuário, 2026-10-26; docs/console-fiscal.md, decisão 7.6). Cada regra
// olha uma linha (a remessa com os retornos ligados) e diz se ela tem o
// problema. A conta é feita na tela, não no servidor, pra acompanhar na
// hora o retorno arrastado ou desfeito. Regra nova entra nesta lista e já
// aparece no card de alertas e no sinal da linha.

export interface RegraAlerta {
  codigo: string;
  rotulo: string;
  ajuda: string;
  testa: (r: LinhaRemessa) => boolean;
}

export const REGRAS_ALERTA: RegraAlerta[] = [
  {
    codigo: "cfop-remessa",
    rotulo: "CFOP da remessa não confere",
    ajuda:
      "A descrição da nota diz remessa, mas o CFOP não é de remessa com retorno. A nota entrou no controle pela descrição.",
    testa: (r) => !r.cfopConfere,
  },
  {
    codigo: "remessa-receita",
    rotulo: "Remessa contada como receita",
    ajuda: "A Gama emitiu a remessa com CFOP de venda: ela entra como receita no relatório de PIS/COFINS.",
    testa: (r) => r.receita,
  },
  {
    codigo: "cfop-retorno",
    rotulo: "CFOP do retorno não confere",
    ajuda:
      "A descrição da nota de retorno diz retorno, mas o CFOP não é de retorno. A nota entrou no controle pela descrição.",
    testa: (r) => r.retornos.some((x) => !x.cfopConfere),
  },
  {
    codigo: "retorno-maior",
    rotulo: "Retorno maior que a remessa",
    ajuda: "Os retornos ligados somam mais do que o valor da remessa.",
    testa: (r) => r.retornos.reduce((s, x) => s + Number(x.valor), 0) > Number(r.valor) + 0.01,
  },
  {
    codigo: "retorno-antes",
    rotulo: "Retorno com data anterior à remessa",
    ajuda: "Um retorno ligado foi emitido antes da própria remessa.",
    testa: (r) => r.retornos.some((x) => x.dataEmissao < r.dataEmissao),
  },
  {
    codigo: "retorno-outra-empresa",
    rotulo: "Retorno de outra empresa",
    ajuda: "Um retorno ligado é de outro CNPJ (outra raiz) que não o da remessa.",
    testa: (r) => r.retornos.some((x) => !mesmaEmpresa(r.documento, x.documento)),
  },
];

export function alertasDaLinha(r: LinhaRemessa): RegraAlerta[] {
  return REGRAS_ALERTA.filter((regra) => regra.testa(r));
}

export interface SituacaoAlertas {
  pendentes: RegraAlerta[];
  tratados: RegraAlerta[];
}

// Alertas de cada linha separados em pendentes e tratados pelo último
// registro do log (decisão 7.7). Usado na tela e na impressão, pra as
// duas contarem igual.
export function situacoesAlertas(rows: LinhaRemessa[], log: RegistroAlerta[]): Map<string, SituacaoAlertas> {
  const ultimo = new Map<string, RegistroAlerta>();
  for (const registro of log) ultimo.set(`${registro.remessaChave}|${registro.regra}`, registro);
  return new Map(
    rows.map((r) => {
      const todos = alertasDaLinha(r);
      const tratado = (codigo: string) => ultimo.get(`${r.chave}|${codigo}`)?.acao === "tratar";
      return [r.chave, { pendentes: todos.filter((a) => !tratado(a.codigo)), tratados: todos.filter((a) => tratado(a.codigo)) }];
    }),
  );
}

// Filtro do card de alertas: "" = sem filtro; "qualquer" = linha com
// alerta pendente; "tratados" = linha com alerta já tratado; ou o código
// da regra (pendente).
export function passaFiltroAlerta(filtro: string, s: SituacaoAlertas | undefined): boolean {
  if (!filtro) return true;
  if (filtro === "qualquer") return (s?.pendentes.length ?? 0) > 0;
  if (filtro === "tratados") return (s?.tratados.length ?? 0) > 0;
  return s?.pendentes.some((a) => a.codigo === filtro) ?? false;
}

export function rotuloFiltroAlerta(filtro: string): string {
  if (filtro === "qualquer") return "Todos os alertas";
  if (filtro === "tratados") return "Tratados";
  return REGRAS_ALERTA.find((r) => r.codigo === filtro)?.rotulo ?? filtro;
}

// Texto do sinal da linha, um alerta por item.
export function textoAlertas(s: SituacaoAlertas): string[] {
  return [...s.pendentes.map((a) => `• ${a.rotulo}: ${a.ajuda}`), ...s.tratados.map((a) => `✓ ${a.rotulo} (tratado)`)];
}

// CNPJ compara pela raiz (8 primeiros dígitos), pra matriz e filial da
// mesma empresa não virarem alerta; CPF compara inteiro. Sem documento de
// um dos lados, não dá pra dizer — não alerta.
function mesmaEmpresa(a: string | null, b: string | null): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  if (!da || !db) return true;
  if (da.length === 14 && db.length === 14) return da.slice(0, 8) === db.slice(0, 8);
  return da === db;
}
