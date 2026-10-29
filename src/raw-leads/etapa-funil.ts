import type { RawLeadEtapa } from '@prisma/client';

// Etapas do funil de prospecção (2026-09-23, pedido do usuário:
// "reestruturar as etapas do funil — Prospectar/Entrada > Andamento >
// Reunião > Qualificado > Negociação/Fechamento").
//
// Antes a faixa do lead era DERIVADA do par status + manualTier (sem prazo
// = prospect, com prazo = qualificado, aprovado = convertido). Isso dava
// conta de três degraus e não tinha onde pendurar "o SDR já falou com a
// empresa" nem "tem reunião marcada" — que é justamente o meio do
// trabalho do SDR, e o que o quadro Kanban precisa ter como coluna pra
// poder arrastar o cartão.
//
// Agora é coluna própria (raw_leads.etapa), movida à mão no quadro e
// empurrada sozinha pelos eventos que já existiam:
//   registrou qualquer interação  → Andamento
//   registrou/agendou reunião     → Reunião
//   informou prazo de investimento → Qualificado
//   converteu o lead              → Negociação/Fechamento
//
// Descartado NÃO é etapa: continua sendo `status`, e o lead descartado
// some do quadro (tem aba própria). Um lead descartado guarda a etapa em
// que parou.
export const ETAPAS_FUNIL = [
  'entrada',
  'andamento',
  'reuniao',
  'qualificado',
  'negociacao',
] as const satisfies readonly RawLeadEtapa[];

export const ETAPA_LABEL: Record<RawLeadEtapa, string> = {
  entrada: 'Prospectar/Entrada',
  andamento: 'Andamento',
  reuniao: 'Reunião',
  qualificado: 'Qualificado',
  negociacao: 'Negociação/Fechamento',
};

// Posição na régua — o avanço automático nunca RETROCEDE o cartão (quem
// puxa pra trás é a pessoa, arrastando no quadro): um lead já qualificado
// que recebe mais uma ligação continua qualificado.
export function ordemDaEtapa(etapa: RawLeadEtapa): number {
  return ETAPAS_FUNIL.indexOf(etapa);
}

export function etapaAvancada(
  atual: RawLeadEtapa,
  alvo: RawLeadEtapa,
): RawLeadEtapa {
  return ordemDaEtapa(alvo) > ordemDaEtapa(atual) ? alvo : atual;
}

// Data da primeira entrada em Andamento/Reunião (2026-10-21) — é o que o
// funil do Painel usa pra contar quem avançou no período. Vale a primeira
// vez: puxar o cartão de volta e avançar de novo não reescreve a data.
// Qualificado e Negociação já têm a sua (qualifiedAt segue o prazo de
// investimento, convertedAt a conversão).
export function marcaPassagem(
  etapa: RawLeadEtapa,
  atual: { andamentoAt: Date | null; reuniaoAt: Date | null },
  agora: Date = new Date(),
): { andamentoAt?: Date; reuniaoAt?: Date } {
  if (etapa === 'andamento' && !atual.andamentoAt) {
    return { andamentoAt: agora };
  }
  if (etapa === 'reuniao' && !atual.reuniaoAt) return { reuniaoAt: agora };
  return {};
}

// Etapa que um registro da Timeline empurra o lead a alcançar.
// `null` = esse tipo de registro não mexe na etapa.
export function etapaDoSubtipo(
  subtipo: string | undefined,
): RawLeadEtapa | null {
  if (!subtipo) return null;
  if (subtipo === 'reuniao') return 'reuniao';
  // Anotação também conta como trabalho feito: o SDR registrar qualquer
  // coisa na ficha significa que o lead saiu da fila parada.
  if (['nota', 'ligacao', 'visita', 'email'].includes(subtipo)) {
    return 'andamento';
  }
  return null;
}
