import { dayKeyBR } from "@/lib/format-date";

// Selo de SLA do card do Pipeline — SLA automático (pedido do usuário,
// 2026-09-16). Mede quanto tempo o time leva pra concluir a proposta:
// **dias úteis** (segunda a sexta, sem feriados) do início da contagem até
// a proposta sair das etapas de proposta.
//
// - Início: a data de revisão (cliente pediu alteração) ou, sem revisão,
//   a abertura.
// - Fim: `slaDueDate`, gravado pelo backend quando o card entra em
//   Negociação e Fechamento. Vazio = pendente, conta até hoje.
//
// Regra completa em src/opportunities/opportunity-sla.ts; a mesma conta
// existe lá pro e-mail — as duas precisam bater.
export interface Sla {
  dias: number;
  pendente: boolean;
  revisado: boolean;
}

export type SlaTratamento = "erro_elaboracao" | "alteracao_cliente";

const ETAPAS_DE_PROPOSTA = new Set(
  ["Solicitação de Propostas", "Elaboração de Propostas", "Aprovação de Propostas"].map(chaveEtapa),
);

function chaveEtapa(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function ehEtapaDeProposta(stage: { name: string }): boolean {
  return ETAPAS_DE_PROPOSTA.has(chaveEtapa(stage.name));
}

// Dias úteis entre dois dias no formato "AAAA-MM-DD".
export function diasUteisEntre(inicio: string, fim: string): number {
  let atual = Date.parse(`${inicio}T12:00:00Z`);
  const limite = Date.parse(`${fim}T12:00:00Z`);
  let dias = 0;
  while (atual < limite) {
    atual += 86400000;
    const semana = new Date(atual).getUTCDay();
    if (semana !== 0 && semana !== 6) dias++;
  }
  return dias;
}

export function calcularSla(opportunity: {
  createdAt: string;
  slaDueDate: string | null;
  slaRevisionDate?: string | null;
}): Sla {
  // Abertura é instante (lida no dia de Brasília); revisão e fim são datas
  // sem hora, gravadas como meia-noite UTC — por isso o slice, sem fuso.
  const inicio = opportunity.slaRevisionDate
    ? opportunity.slaRevisionDate.slice(0, 10)
    : dayKeyBR(new Date(opportunity.createdAt));
  const fim = opportunity.slaDueDate ? opportunity.slaDueDate.slice(0, 10) : dayKeyBR(new Date());
  return {
    dias: diasUteisEntre(inicio, fim),
    pendente: !opportunity.slaDueDate,
    revisado: Boolean(opportunity.slaRevisionDate),
  };
}

export function slaSelo(sla: Sla): string {
  return `${sla.dias}d`;
}

export function slaTitulo(sla: Sla): string {
  const desde = sla.revisado ? "a revisão pedida pelo cliente" : "a abertura";
  return sla.pendente
    ? `SLA em andamento: ${sla.dias} dia(s) útil(eis) desde ${desde}`
    : `SLA concluído: ${sla.dias} dia(s) útil(eis) desde ${desde} até a proposta ir para Negociação`;
}
