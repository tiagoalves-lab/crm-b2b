import { dayKeyBR } from "@/lib/format-date";

// "Data rápida" dos filtros (mesma ideia do eGestor): a pessoa escolhe a
// faixa num select e só digita data quando escolhe "Personalizado". A
// conta é feita em dia civil de BRASÍLIA — o servidor da Vercel roda em
// UTC, e "últimos 30 dias" calculado lá vira o dia errado depois das 21h
// (mesma armadilha de web/lib/format-date.ts).
export const PERIODOS = [
  { valor: "7", label: "Últimos 7 dias" },
  { valor: "30", label: "Últimos 30 dias" },
  { valor: "90", label: "Últimos 90 dias" },
  { valor: "mes", label: "Este mês" },
  { valor: "mes-anterior", label: "Mês passado" },
  { valor: "ano", label: "Este ano" },
  { valor: "personalizado", label: "Personalizado" },
] as const;

export const PERIODO_PADRAO = "30";

// Soma (ou subtrai) dias de um "AAAA-MM-DD" sem passar por fuso: meio-dia
// UTC como âncora nunca escorrega de dia.
function somaDias(dia: string, dias: number): string {
  const data = new Date(`${dia}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

export interface Faixa {
  inicio: string;
  fim: string;
}

export function faixaDoPeriodo(
  periodo: string,
  personalizado: { inicio?: string; fim?: string } = {},
): Faixa {
  const hoje = dayKeyBR(new Date());
  const [ano, mes] = hoje.split("-");

  switch (periodo) {
    case "7":
    case "30":
    case "90":
      // "Últimos 30 dias" inclui hoje — 29 dias para trás + hoje, mesma
      // contagem do eGestor.
      return { inicio: somaDias(hoje, -(Number(periodo) - 1)), fim: hoje };
    case "mes":
      return { inicio: `${ano}-${mes}-01`, fim: hoje };
    case "mes-anterior": {
      const primeiroDesteMes = `${ano}-${mes}-01`;
      const ultimoDoAnterior = somaDias(primeiroDesteMes, -1);
      return { inicio: `${ultimoDoAnterior.slice(0, 7)}-01`, fim: ultimoDoAnterior };
    }
    case "ano":
      return { inicio: `${ano}-01-01`, fim: hoje };
    default: {
      // Personalizado: o que veio do formulário, com o padrão de 30 dias
      // como rede se a pessoa mandar um campo vazio.
      const padrao = faixaDoPeriodo(PERIODO_PADRAO);
      const inicio = ehDia(personalizado.inicio) ? personalizado.inicio! : padrao.inicio;
      const fim = ehDia(personalizado.fim) ? personalizado.fim! : padrao.fim;
      return inicio <= fim ? { inicio, fim } : { inicio: fim, fim: inicio };
    }
  }
}

function ehDia(valor?: string): boolean {
  return !!valor && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

// "01/09/2026 a 23/09/2026" — linha que o cabeçalho do relatório mostra
// pra pessoa saber exatamente o que gerou.
export function faixaPorExtenso(faixa: Faixa): string {
  const br = (dia: string) => dia.split("-").reverse().join("/");
  return `${br(faixa.inicio)} a ${br(faixa.fim)}`;
}
