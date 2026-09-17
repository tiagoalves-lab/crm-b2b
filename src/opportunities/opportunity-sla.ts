import type { Opportunity, Stage } from '@prisma/client';
import { diaBR, diasUteisEntre, FUSO_PADRAO } from '../reports/report-datas';

// SLA da proposta automático (pedido do usuário, 2026-09-16) — mede quanto
// tempo o time leva da abertura da proposta até ela sair das etapas de
// proposta. Ninguém digita data nenhuma:
//
// - Enquanto o card está numa etapa de proposta (Solicitação, Elaboração,
//   Aprovação), o SLA está PENDENTE: `slaDueDate` fica vazio e a conta
//   corre até hoje.
// - Ao entrar em "Negociação e Fechamento" (ou encerrar a oportunidade
//   ainda em proposta), `slaDueDate` recebe a data do dia — o SLA fecha.
// - Ao VOLTAR de Negociação para uma etapa de proposta, quem arrasta
//   escolhe o tratamento (`SlaTratamento`): erro na elaboração continua a
//   contagem do início; alteração pedida pelo cliente reinicia a contagem
//   a partir de hoje (`slaRevisionDate`).
//
// O início da contagem é a revisão, se houver, senão a abertura.

export const SLA_TRATAMENTOS = [
  'erro_elaboracao',
  'alteracao_cliente',
] as const;
export type SlaTratamento = (typeof SLA_TRATAMENTOS)[number];

// Etapas em que a proposta ainda está com o time. Casadas pelo nome sem
// acento e sem diferença de maiúscula, mesmo critério do follow-up.
const ETAPAS_DE_PROPOSTA = new Set(
  [
    'Solicitação de Propostas',
    'Elaboração de Propostas',
    'Aprovação de Propostas',
  ].map(chaveEtapa),
);

export function chaveEtapa(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

export function ehEtapaDeProposta(stage: Pick<Stage, 'name'>): boolean {
  return ETAPAS_DE_PROPOSTA.has(chaveEtapa(stage.name));
}

// Data do dia em Brasília como Date de coluna DATE (meia-noite UTC).
export function hojeComoData(agora: Date = new Date()): Date {
  return new Date(`${diaBR(agora, FUSO_PADRAO)}T00:00:00Z`);
}

// Dias úteis do SLA: do início (revisão ou abertura) até o encerramento
// ou, se pendente, até hoje.
export function diasDeSla(
  opp: Pick<Opportunity, 'createdAt' | 'slaDueDate' | 'slaRevisionDate'>,
  agora: Date = new Date(),
  tz: string = FUSO_PADRAO,
): number {
  const inicio = opp.slaRevisionDate
    ? opp.slaRevisionDate.toISOString().slice(0, 10)
    : diaBR(opp.createdAt, tz);
  const fim = opp.slaDueDate
    ? opp.slaDueDate.toISOString().slice(0, 10)
    : diaBR(agora, tz);
  return diasUteisEntre(inicio, fim);
}
