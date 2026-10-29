import {
  assuntoReportDiario,
  montarReportDiarioHtml,
} from './report-template';
import type { DadosReportDiario } from './report.types';

const BASE: DadosReportDiario = {
  dataExtenso: 'Segunda-feira, 15 de setembro de 2026',
  diaCurto: '15/09',
  diaSemana: 'Segunda-feira',
  totalEmAberto: 1883580,
  totalOportunidades: 2,
  semValorDefinido: 1,
  etapas: [],
  pipeline: [
    {
      nr: 1,
      abertura: '08/09',
      fechamentoPrevisto: '30/09',
      empresa: 'Metalúrgica Exemplo',
      representante: 'Fulano de Tal',
      etapa: 'Solicitação de Propostas',
      etapaOrdem: 1,
      slaDias: 7,
      itens: ['Máquina A', 'Máquina B'],
      valor: 20200,
    },
    {
      nr: 2,
      abertura: '11/09',
      fechamentoPrevisto: null,
      empresa: 'Indústria <script>alerta</script>',
      representante: 'Beltrano',
      etapa: 'Negociação e Fechamento',
      etapaOrdem: 4,
      slaDias: 4,
      itens: [],
      valor: null,
    },
  ],
  fixadas: [
    {
      empresa: 'Metalúrgica Exemplo',
      texto: 'Cliente pediu prazo de 45 dias.',
      autor: 'Fulano de Tal',
      fixadoEm: '11/09',
    },
  ],
  tarefas: [
    {
      titulo: 'Enviar proposta revisada',
      empresa: 'Metalúrgica Exemplo',
      responsavel: 'Fulano de Tal',
      grupo: 'atrasada',
      quando: '3 dias',
    },
    {
      titulo: 'Reunião de fechamento',
      empresa: null,
      responsavel: 'Beltrano',
      grupo: 'semana',
      quando: 'hoje',
    },
    {
      titulo: 'Visita técnica',
      empresa: 'Metalúrgica Exemplo',
      responsavel: 'Fulano de Tal',
      grupo: 'proxima-semana',
      quando: 'qua 24/09',
    },
  ],
  totalTarefasPendentes: 9,
  tarefasNoRecorte: 3,
  tarefasRecorteAte: 'dom 28/09',
  tarefasAtrasadas: 1,
  appUrl: 'https://crm.exemplo.com.br',
};

describe('template do resumo diário', () => {
  it('monta o assunto com a data e o dia da semana', () => {
    expect(assuntoReportDiario(BASE)).toBe(
      'Resumo do dia — 15/09 · Segunda-feira',
    );
  });

  it('não leva números no assunto', () => {
    // Decisão do usuário (2026-09-15): valor em aberto e tarefas atrasadas
    // saíram do assunto e ficaram só no cabeçalho do e-mail.
    const assunto = assuntoReportDiario(BASE);
    expect(assunto).not.toContain('R$');
    expect(assunto).not.toContain('atrasada');
  });

  it('traz as três seções e a numeração na sequência do quadro', () => {
    const html = montarReportDiarioHtml(BASE);

    expect(html).toContain('Pipeline de oportunidades');
    expect(html).toContain('Comentários fixados');
    expect(html).toContain('Tarefas pendentes');
    // Cabeçalhos da tabela aprovada pelo usuário.
    for (const coluna of [
      'Abertura',
      'Fech. prev.',
      'Empresa',
      'Representante',
      'Status',
      'SLA',
      'Itens',
    ]) {
      expect(html).toContain(coluna);
    }
    expect(html).toContain('Máquina A · Máquina B');
    expect(html).toContain('7d');
  });

  it('agrupa as tarefas em atrasadas, esta semana e próxima semana', () => {
    const html = montarReportDiarioHtml(BASE);
    expect(html).toContain('Atrasadas');
    expect(html).toContain('Esta semana');
    expect(html).toContain('Próxima semana');
    expect(html).toContain('3 de 9 pendentes');
    // O que ficou fora do recorte é avisado, não some em silêncio.
    expect(html).toContain('6 outras pendentes têm prazo depois de dom 28/09');
    expect(html).not.toContain('no total');
  });

  it('avisa quando há pendentes mas nenhuma no recorte', () => {
    const html = montarReportDiarioHtml({
      ...BASE,
      tarefas: [],
      tarefasNoRecorte: 0,
      tarefasAtrasadas: 0,
    });
    expect(html).toContain('Nenhuma tarefa atrasada nem com prazo nesta semana ou na próxima.');
    expect(html).toContain('9 outras pendentes');
  });

  it('mostra "a definir" e "—" em vez de zero quando não há valor/previsão', () => {
    const html = montarReportDiarioHtml(BASE);
    expect(html).toContain('1 sem valor definido');
    expect(html).not.toContain('R$ 0');
  });

  it('escapa conteúdo vindo do banco', () => {
    const html = montarReportDiarioHtml(BASE);
    expect(html).not.toContain('<script>alerta</script>');
    expect(html).toContain('&lt;script&gt;alerta&lt;/script&gt;');
  });

  it('não quebra com todas as seções vazias', () => {
    const html = montarReportDiarioHtml({
      ...BASE,
      pipeline: [],
      fixadas: [],
      tarefas: [],
      totalOportunidades: 0,
      totalTarefasPendentes: 0,
      tarefasNoRecorte: 0,
      tarefasAtrasadas: 0,
      totalEmAberto: 0,
      semValorDefinido: 0,
      appUrl: null,
    });

    expect(html).toContain('Nenhuma oportunidade aberta no quadro.');
    expect(html).toContain('Nenhum comentário fixado');
    expect(html).toContain('Nenhuma tarefa pendente.');
    expect(html).not.toContain('Abrir o CRM');
  });
});
