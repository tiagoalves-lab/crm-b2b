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

// Dia "AAAA-MM-DD" em que cai o prazo de uma tarefa. Prazo só-data vem de
// um <input type="date"> e é gravado como meia-noite UTC — lido no fuso de
// Brasília ele recuaria pro dia anterior (era o caso do resumo até
// 2026-10-22: tarefa de hoje saía como "1 dia" atrasada). Prazo com hora
// marcada é instante real, então vale o dia em Brasília. Mesma régua de
// web/app/dashboard/tarefas/calendar-view.tsx#dueDateKey.
export function diaDoPrazo(
  dueAt: Date,
  comHora: boolean,
  tz: string = FUSO_PADRAO,
): string {
  return comHora ? diaBR(dueAt, tz) : dueAt.toISOString().slice(0, 10);
}

// Diferença em dias entre dois dias "AAAA-MM-DD" (positivo = `ate` depois).
export function diasEntre(de: string, ate: string): number {
  return Math.round(
    (Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) /
      86_400_000,
  );
}

// Soma `dias` a um dia "AAAA-MM-DD".
export function somarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T12:00:00Z`) + dias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// Domingo que fecha a semana do dia "AAAA-MM-DD" — semana de segunda a
// domingo, como no W0/W+1 que o usuário usa (2026-10-22).
export function domingoDaSemana(dia: string): string {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return somarDias(dia, semana === 0 ? 0 : 7 - semana);
}

// "seg 27/10" — dia da semana abreviado + dia curto, pra lista de tarefas
// agrupada por semana.
export function diaComSemanaCurto(dia: string): string {
  const nomes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const [, mes, d] = dia.split('-');
  return `${nomes[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${d}/${mes}`;
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
