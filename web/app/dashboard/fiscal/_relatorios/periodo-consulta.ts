import { dayKeyBR } from "@/lib/format-date";

// Período da aba Consultar notas: um campo só, com atalhos e a escolha de
// um mês (pedido do usuário, 2026-10-28). Vai na querystring como
// `periodo` — atalho ("mes", "ano"...), o mês escolhido ("2026-10") ou
// "personalizado" com `inicio`/`fim`. Conta em dia civil de Brasília (o
// servidor da Vercel roda em UTC; mesma armadilha de periodo.ts).

// A base tem nota desde jul/2022 (docs/console-fiscal.md, decisão 5.1).
export const INICIO_DA_BASE = "2022-07-01";

export const ATALHOS = [
  { valor: "mes", label: "Este mês" },
  { valor: "mes-anterior", label: "Mês anterior" },
  { valor: "tri", label: "Este trimestre" },
  { valor: "mes-x", label: "Mês" },
  { valor: "ano", label: "Este ano" },
  { valor: "12m", label: "Últimos 12 meses" },
  { valor: "tudo", label: "Desde o início" },
] as const;

export const MESES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MESES_NOME = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export interface FaixaConsulta {
  periodo: string;
  inicio: string;
  fim: string;
  rotulo: string;
}

const dois = (n: number) => String(n).padStart(2, "0");

// Primeiro e último dia do mês `mes0` (0 = janeiro) — aceita mês fora de
// 0..11 e acerta o ano.
function mesInteiro(ano: number, mes0: number): { inicio: string; fim: string } {
  const primeiro = new Date(Date.UTC(ano, mes0, 1));
  const ultimo = new Date(Date.UTC(ano, mes0 + 1, 0));
  return { inicio: primeiro.toISOString().slice(0, 10), fim: ultimo.toISOString().slice(0, 10) };
}

const ehDia = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function faixaConsulta(periodo?: string, inicio?: string, fim?: string): FaixaConsulta {
  const hoje = dayKeyBR(new Date());
  const ano = Number(hoje.slice(0, 4));
  const mes0 = Number(hoje.slice(5, 7)) - 1;

  const mesEscolhido = periodo?.match(/^(\d{4})-(\d{2})$/);
  if (mesEscolhido) {
    const a = Number(mesEscolhido[1]);
    const m = Number(mesEscolhido[2]) - 1;
    if (m >= 0 && m <= 11) return { periodo: periodo!, ...mesInteiro(a, m), rotulo: `${MESES_NOME[m]}/${a}` };
  }
  switch (periodo) {
    case "mes-anterior":
      return { periodo, ...mesInteiro(ano, mes0 - 1), rotulo: "Mês anterior" };
    case "tri": {
      const t = mes0 - (mes0 % 3);
      return {
        periodo,
        inicio: mesInteiro(ano, t).inicio,
        fim: mesInteiro(ano, t + 2).fim,
        rotulo: "Este trimestre",
      };
    }
    case "ano":
      return { periodo, inicio: `${ano}-01-01`, fim: `${ano}-12-31`, rotulo: "Este ano" };
    case "12m":
      return {
        periodo,
        inicio: mesInteiro(ano, mes0 - 11).inicio,
        fim: mesInteiro(ano, mes0).fim,
        rotulo: "Últimos 12 meses",
      };
    case "tudo":
      return { periodo, inicio: INICIO_DA_BASE, fim: hoje, rotulo: "Desde o início" };
    case "personalizado":
      if (ehDia(inicio) && ehDia(fim)) {
        const [i, f] = inicio! <= fim! ? [inicio!, fim!] : [fim!, inicio!];
        return { periodo, inicio: i, fim: f, rotulo: "Personalizado" };
      }
      break;
  }
  return { periodo: "mes", ...mesInteiro(ano, mes0), rotulo: "Este mês" };
}

export function chaveMes(ano: number, mes0: number): string {
  return `${ano}-${dois(mes0 + 1)}`;
}

// Filtros da janela, com os mesmos nomes da querystring e da API.
// Fica aqui (e não no componente da barra, que roda no navegador) porque
// a tela do servidor também lê a lista.
export const CHAVES_EXTRAS = [
  "doc",
  "situacao",
  "serie",
  "chave",
  "sentido",
  "emitente",
  "estabelecimento",
  "transferencia",
  "uf",
  "ncm",
  "servico",
  "classe",
  "cfop",
  "marcas",
  "impostos",
  "vNotaMin",
  "vNotaMax",
  "vItemMin",
  "vItemMax",
] as const;
