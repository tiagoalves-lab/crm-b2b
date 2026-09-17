// Formato intermediário entre a consulta ao banco (report.service.ts) e o
// HTML do e-mail (report-template.ts). Existe pra que o template seja uma
// função pura de dados — é o que deixa a prévia do layout ser conferida
// sem banco e sem envio.

export interface LinhaPipeline {
  // Numeração na sequência do quadro: primeiro todos os cards da etapa 1,
  // depois os da etapa 2, e assim por diante (pedido do usuário,
  // 2026-09-15). É o que amarra a linha da tabela ao card do Pipeline.
  nr: number;
  abertura: string; // "08/09"
  fechamentoPrevisto: string | null; // "30/09" — null quando não há previsão
  empresa: string;
  representante: string;
  etapa: string;
  // Índice da etapa (1..N) — o template usa pra escolher a cor da linha.
  etapaOrdem: number;
  // Dias úteis entre a abertura e o Prazo SLA (2026-09-16); null = sem
  // Prazo SLA, o e-mail mostra "—".
  slaDias: number | null;
  itens: string[];
  valor: number | null; // null = sem valor definido
}

export interface AnotacaoFixada {
  empresa: string;
  texto: string;
  autor: string;
  fixadoEm: string; // "11/09"
}

export interface TarefaPendente {
  titulo: string;
  empresa: string | null;
  responsavel: string;
  // "atrasada" | "hoje" | "proxima" — o template agrupa por isto.
  grupo: 'atrasada' | 'hoje' | 'proxima';
  // Texto já pronto: "3 dias", "hoje", "17/09".
  quando: string;
}

export interface EtapaResumo {
  nome: string;
  ordem: number;
  quantidade: number;
  valor: number;
}

export interface DadosReportDiario {
  // Data por extenso no cabeçalho ("Segunda-feira, 15 de setembro de 2026").
  dataExtenso: string;
  diaCurto: string; // "15/09" — usado no assunto
  diaSemana: string; // "Segunda-feira" — também no assunto
  totalEmAberto: number;
  totalOportunidades: number;
  semValorDefinido: number;
  etapas: EtapaResumo[];
  pipeline: LinhaPipeline[];
  fixadas: AnotacaoFixada[];
  tarefas: TarefaPendente[];
  totalTarefasPendentes: number;
  tarefasAtrasadas: number;
  appUrl: string | null;
}

// Report de follow-up das cotações (2026-09-15): só as oportunidades das
// etapas de proposta, quatro vezes por dia útil. Reusa as mesmas linhas do
// pipeline do resumo diário — muda o recorte, a ordem e o cabeçalho.
export interface DadosFollowup {
  dataExtenso: string;
  diaCurto: string;
  // Horário do disparo ("10h", "11h50") — aparece no assunto e no
  // cabeçalho, pra distinguir uma rodada da outra na caixa de entrada.
  horario: string;
  etapasAcompanhadas: string[];
  totalEmAberto: number;
  totalOportunidades: number;
  semValorDefinido: number;
  // Maior SLA da lista — o número que resume "o mais parado está parado
  // há tanto tempo".
  maiorSla: number;
  pipeline: LinhaPipeline[];
  appUrl: string | null;
}
