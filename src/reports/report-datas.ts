// Datas do report no fuso de Brasília. O container roda em UTC (Railway),
// então nada aqui pode usar o fuso do processo: às 21h de Brasília o
// servidor já está no dia seguinte, e o "resumo de hoje" sairia com a data
// errada e contaria tarefa do dia errado como atrasada. Mesmo problema já
// resolvido no frontend em web/lib/format-date.ts (2026-08-13) — esta é a
// versão do backend, sem dependência nova.

export const FUSO_PADRAO = 'America/Sao_Paulo';

// "2026-09-15" no fuso informado. en-CA devolve exatamente ISO curto.
export function diaBR(data: Date, tz: string = FUSO_PADRAO): string {
  return data.toLocaleDateString('en-CA', { timeZone: tz });
}

// "15/09" — usado nas colunas de data da tabela e no assunto do e-mail.
export function diaCurtoBR(data: Date, tz: string = FUSO_PADRAO): string {
  const [, mes, dia] = diaBR(data, tz).split('-');
  return `${dia}/${mes}`;
}

// "Segunda-feira, 15 de setembro de 2026" — cabeçalho do e-mail.
export function dataExtensoBR(data: Date, tz: string = FUSO_PADRAO): string {
  const texto = data.toLocaleDateString('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Diferença em dias de CALENDÁRIO (não em milissegundos) entre dois
// instantes, lida no fuso de Brasília. É a mesma conta do indicador de SLA
// do card do Pipeline (web/app/dashboard/pipeline/sla.ts): um negócio
// aberto ontem às 23h precisa aparecer com 1 dia, não com 0 até completar
// 24 horas.
export function diferencaEmDias(
  de: Date,
  ate: Date,
  tz: string = FUSO_PADRAO,
): number {
  const inicio = Date.parse(`${diaBR(de, tz)}T12:00:00Z`);
  const fim = Date.parse(`${diaBR(ate, tz)}T12:00:00Z`);
  return Math.round((fim - inicio) / 86_400_000);
}

// Dias úteis (segunda a sexta, sem feriados) entre dois dias "AAAA-MM-DD":
// conta os dias DEPOIS do início até o fim, inclusive. É o selo de SLA
// (pedido do usuário, 2026-09-16): abertura → Prazo SLA. Mesma conta de
// web/app/dashboard/pipeline/sla.ts — as duas precisam bater.
export function diasUteisEntre(inicio: string, fim: string): number {
  let atual = Date.parse(`${inicio}T12:00:00Z`);
  const limite = Date.parse(`${fim}T12:00:00Z`);
  let dias = 0;
  while (atual < limite) {
    atual += 86_400_000;
    const semana = new Date(atual).getUTCDay();
    if (semana !== 0 && semana !== 6) dias++;
  }
  return dias;
}

// Valor em reais no formato que o e-mail mostra ("R$ 1.883.580").
// Sem centavos de propósito: é um resumo de gestão, não um extrato.
export function moedaBR(valor: number): string {
  return `R$ ${Math.round(valor).toLocaleString('pt-BR')}`;
}

// "Segunda-feira" — só o dia da semana, com a primeira letra maiúscula.
// Vai no assunto do e-mail (pedido do usuário, 2026-09-15).
export function diaSemanaBR(data: Date, tz: string = FUSO_PADRAO): string {
  const texto = data.toLocaleDateString('pt-BR', {
    timeZone: tz,
    weekday: 'long',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// "10h" / "11h50" — horário do disparo, usado pra distinguir uma rodada
// do follow-up da outra na caixa de entrada.
export function horarioBR(data: Date, tz: string = FUSO_PADRAO): string {
  const texto = data.toLocaleTimeString('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  });
  const [hora, minuto] = texto.split(':');
  return minuto === '00' ? `${hora}h` : `${hora}h${minuto}`;
}
