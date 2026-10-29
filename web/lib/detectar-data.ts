// Datas de retorno (2026-10-28, pedido do usuário): o vendedor escreve
// "contatar novamente em janeiro 2027" na Timeline e não cria tarefa —
// o combinado cai no esquecimento. Este arquivo faz duas coisas:
//   1. calcula as datas dos atalhos "Em 7 dias / 30 dias / 3 meses";
//   2. procura uma data mencionada no texto, pra tela sugerir o lembrete.
//
// Tudo trabalha com "chave do dia" (yyyy-mm-dd) e Date em UTC, sem hora —
// o lembrete é "um dia sem horário", igual ao prazo de tarefa comum
// (ver formatDateOnlyBR em format-date.ts). "Hoje" vem de fora, já em
// Brasília (dayKeyBR), pra não depender do fuso de quem roda o código.

const DIA_MS = 24 * 60 * 60 * 1000;

function deChave(chave: string): Date {
  const [a, m, d] = chave.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function paraChave(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function somarDias(data: Date, dias: number): Date {
  return new Date(data.getTime() + dias * DIA_MS);
}

// Soma meses sem pular o mês curto: 31/01 + 1 mês = 28/02, não 03/03.
function somarMeses(data: Date, meses: number): Date {
  const alvo = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(data.getUTCDate(), ultimoDia));
  return alvo;
}

// Lembrete que cai em sábado ou domingo passa pra segunda.
function diaUtil(data: Date): Date {
  const semana = data.getUTCDay();
  if (semana === 6) return somarDias(data, 2);
  if (semana === 0) return somarDias(data, 1);
  return data;
}

// "Em janeiro" = primeiro dia útil do mês; 1º de janeiro é feriado.
function inicioDoMes(ano: number, mes: number): Date {
  return diaUtil(new Date(Date.UTC(ano, mes, mes === 0 ? 2 : 1)));
}

export type AtalhoRetorno = "7d" | "30d" | "3m";

export function dataDoAtalho(atalho: AtalhoRetorno, hoje: string): string {
  const base = deChave(hoje);
  const data =
    atalho === "7d" ? somarDias(base, 7) : atalho === "30d" ? somarDias(base, 30) : somarMeses(base, 3);
  return paraChave(diaUtil(data));
}

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// "seg, 04/01/2027" — o dia da semana ajuda a pessoa a conferir de cara.
export function rotuloDataRetorno(chave: string): string {
  const data = deChave(chave);
  const dd = String(data.getUTCDate()).padStart(2, "0");
  const mm = String(data.getUTCMonth() + 1).padStart(2, "0");
  return `${DIAS_SEMANA[data.getUTCDay()]}, ${dd}/${mm}/${data.getUTCFullYear()}`;
}

// ── Data mencionada no texto ────────────────────────────────────────────

// Tira acento caractere a caractere, sem mudar o tamanho do texto — assim a
// posição achada no texto normalizado vale no original e o trecho exibido
// sai com a grafia que a pessoa digitou.
const SEM_ACENTO: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", é: "e", ê: "e", í: "i",
  ó: "o", ô: "o", õ: "o", ú: "u", ü: "u", ç: "c",
};

function normalizar(texto: string): string {
  return Array.from(texto.toLowerCase(), (c) => (c.length === 1 ? SEM_ACENTO[c] ?? c : c)).join("");
}

const MESES = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MESES_ABREV = MESES.map((m) => m.slice(0, 3));

const NUMEROS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15,
  vinte: 20, trinta: 30, noventa: 90,
};

const SEMANA_NOMES = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function numero(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMEROS[token] ?? null;
}

function anoCompleto(token: string): number {
  const n = Number(token);
  return token.length === 2 ? 2000 + n : n;
}

// Mês sem ano: a próxima vez que esse mês chegar. Mas mês que acabou de
// passar (até 2 meses atrás) é relato — "visitei em 10/09", "comprou em
// setembro" — e não vira o mesmo mês do ano que vem: devolve null. O mês
// corrente fica neste ano (dia já passado cai no teste de passado lá
// embaixo).
function anoDoMes(mes: number, hoje: Date): number | null {
  const ano = hoje.getUTCFullYear();
  const atual = hoje.getUTCMonth();
  if (mes >= atual) return ano;
  return atual - mes <= 2 ? null : ano + 1;
}

interface Regra {
  padrao: RegExp;
  data: (m: RegExpExecArray, hoje: Date) => Date | null;
}

const MES_RE = MESES.join("|");
const NUM_RE = `\\d{1,3}|${Object.keys(NUMEROS).join("|")}`;

// Ordem importa só no desempate de posição: vence a menção que aparece
// primeiro no texto; no mesmo ponto, a regra listada antes.
const REGRAS: Regra[] = [
  // 15/01/2027, 15/01/27, 15-01-2027
  {
    padrao: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g,
    data: (m) => {
      const ano = anoCompleto(m[3]);
      const d = new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[1])));
      return d.getUTCDate() === Number(m[1]) ? d : null;
    },
  },
  // jan/2027, jan/27, janeiro/2027
  {
    padrao: new RegExp(`\\b(${MES_RE}|${MESES_ABREV.join("|")})\\s*/\\s*(\\d{4}|\\d{2})\\b`, "g"),
    data: (m) => {
      const mes = MESES.indexOf(m[1]) >= 0 ? MESES.indexOf(m[1]) : MESES_ABREV.indexOf(m[1]);
      return inicioDoMes(anoCompleto(m[2]), mes);
    },
  },
  // 15/01 (sem ano): a próxima vez que esse dia chegar
  {
    padrao: /\b(\d{1,2})\/(\d{1,2})\b(?![/.-]\d)/g,
    data: (m, hoje) => {
      const mes = Number(m[2]) - 1;
      if (mes < 0 || mes > 11) return null;
      const ano = anoDoMes(mes, hoje);
      if (ano === null) return null;
      const d = new Date(Date.UTC(ano, mes, Number(m[1])));
      return d.getUTCDate() === Number(m[1]) ? d : null;
    },
  },
  // "15 de janeiro (de 2027)"
  {
    padrao: new RegExp(`\\b(\\d{1,2}) de (${MES_RE})(?:,? (?:de )?(\\d{4}))?\\b`, "g"),
    data: (m, hoje) => {
      const mes = MESES.indexOf(m[2]);
      const ano = m[3] ? Number(m[3]) : anoDoMes(mes, hoje);
      if (ano === null) return null;
      const d = new Date(Date.UTC(ano, mes, Number(m[1])));
      return d.getUTCDate() === Number(m[1]) ? d : null;
    },
  },
  // "início / meados / fim de janeiro (de 2027)", "janeiro (de) 2027", "em janeiro"
  {
    padrao: new RegExp(
      `\\b(?:(inicio|comeco|meados|meio|final|fim) d[eo] )?(${MES_RE})(?:,? (?:de )?(\\d{4}))?\\b`,
      "g",
    ),
    data: (m, hoje) => {
      const mes = MESES.indexOf(m[2]);
      // Mês solto sem ano nem "em/para/até" na frente é arriscado
      // ("maio" pode ser só citação) — exige ano, um qualificador ou
      // preposição imediatamente antes.
      if (!m[1] && !m[3]) {
        const antes = m.input.slice(Math.max(0, m.index - 12), m.index);
        if (!/\b(em|para|pra|ate|no|apos|depois de|a partir de)\s+$/.test(antes)) return null;
      }
      const ano = m[3] ? Number(m[3]) : anoDoMes(mes, hoje);
      if (ano === null) return null;
      if (m[1] === "meados" || m[1] === "meio") return diaUtil(new Date(Date.UTC(ano, mes, 15)));
      if (m[1] === "final" || m[1] === "fim") return diaUtil(new Date(Date.UTC(ano, mes, 25)));
      return inicioDoMes(ano, mes);
    },
  },
  {
    padrao: /\bdepois de amanha\b/g,
    data: (_m, hoje) => somarDias(hoje, 2),
  },
  {
    padrao: /\bamanha\b/g,
    data: (_m, hoje) => somarDias(hoje, 1),
  },
  // "semana que vem", "próxima semana"
  {
    padrao: /\b(?:semana que vem|proxima semana)\b/g,
    data: (_m, hoje) => somarDias(hoje, ((8 - hoje.getUTCDay()) % 7) || 7),
  },
  // "mês que vem", "próximo mês"
  {
    padrao: /\b(?:mes que vem|proximo mes)\b/g,
    data: (_m, hoje) => {
      const prox = somarMeses(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)), 1);
      return inicioDoMes(prox.getUTCFullYear(), prox.getUTCMonth());
    },
  },
  // "ano que vem", "próximo ano"
  {
    padrao: /\b(?:ano que vem|proximo ano)\b/g,
    data: (_m, hoje) => inicioDoMes(hoje.getUTCFullYear() + 1, 0),
  },
  // "fim do mês"
  {
    padrao: /\b(?:fim|final) do mes\b/g,
    data: (_m, hoje) => diaUtil(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 25))),
  },
  // "daqui a 15 dias", "em duas semanas", "dentro de 3 meses"
  {
    padrao: new RegExp(`\\b(?:daqui a|daqui|em|dentro de|apos|depois de) (${NUM_RE}) (dias?|semanas?|mes|meses)\\b`, "g"),
    data: (m, hoje) => {
      const n = numero(m[1]);
      if (!n) return null;
      if (m[2].startsWith("dia")) return somarDias(hoje, n);
      if (m[2].startsWith("semana")) return somarDias(hoje, n * 7);
      return somarMeses(hoje, n);
    },
  },
  // "segunda-feira", "na sexta", "próxima quarta"
  {
    padrao: /\b(?:(?:na|no|ate|proxima|proximo|nesta|neste|essa|esta)\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(-feira| feira)?\b/g,
    data: (m, hoje) => {
      // "segunda" sozinha também é ordinal ("segunda máquina") — só vale
      // com "-feira" ou com preposição na frente.
      const temPrefixo = m[0] !== m[1] + (m[2] ?? "");
      if (!m[2] && !temPrefixo) return null;
      const alvo = SEMANA_NOMES.indexOf(m[1]);
      return somarDias(hoje, ((alvo - hoje.getUTCDay() + 7) % 7) || 7);
    },
  },
];

export interface DataMencionada {
  // Trecho como a pessoa escreveu ("janeiro 2027").
  trecho: string;
  // yyyy-mm-dd, já em dia útil.
  data: string;
}

// Primeira data FUTURA mencionada no texto. Data no passado (ou hoje) é
// relato do que já aconteceu ("visitei em 10/09"), não retorno combinado.
export function detectarDataNoTexto(texto: string, hoje: string): DataMencionada | null {
  const norm = normalizar(texto);
  const base = deChave(hoje);
  let melhor: { pos: number; trecho: string; data: Date } | null = null;

  for (const regra of REGRAS) {
    regra.padrao.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regra.padrao.exec(norm))) {
      if (melhor && m.index >= melhor.pos) break;
      const data = regra.data(m, base);
      if (!data || data.getTime() <= base.getTime()) continue;
      melhor = { pos: m.index, trecho: texto.slice(m.index, m.index + m[0].length), data: diaUtil(data) };
      break;
    }
  }

  return melhor ? { trecho: melhor.trecho.trim(), data: paraChave(melhor.data) } : null;
}
