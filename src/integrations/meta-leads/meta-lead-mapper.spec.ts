import { legivel, mapearLeadDoMeta } from './meta-lead-mapper';
import type { MetaLeadDetail } from './meta-leads.types';

function lead(
  campos: Array<{ name: string; values: unknown[] }>,
): MetaLeadDetail {
  return { id: 'lead-1', field_data: campos };
}

describe('mapearLeadDoMeta', () => {
  it('mapeia os campos padrão de um formulário de contato', () => {
    const { rawLead, contato, respostasNaoMapeadas } = mapearLeadDoMeta(
      lead([
        { name: 'full_name', values: ['Joana Prado'] },
        { name: 'email', values: ['joana@exemplo.com.br'] },
        { name: 'phone_number', values: ['+55 11 90000-0000'] },
        { name: 'company_name', values: ['Indústria Modelo Ltda'] },
        { name: 'job_title', values: ['Gerente de Compras'] },
        { name: 'city', values: ['Campinas'] },
        { name: 'state', values: ['SP'] },
      ]),
      '777',
    );

    expect(rawLead).toMatchObject({
      razaoSocial: 'Indústria Modelo Ltda',
      fonte: 'meta_leads',
      municipio: 'Campinas',
      uf: 'SP',
      emails: ['joana@exemplo.com.br'],
      fones: ['+55 11 90000-0000'],
      // Tag pedida pelo usuário (2026-09-04) — é por ela que a Prospecção
      // filtra os leads do Meta.
      tags: ['Meta Business'],
    });
    expect(contato).toEqual({
      nome: 'Joana Prado',
      email: 'joana@exemplo.com.br',
      telefone: '+55 11 90000-0000',
      cargo: 'Gerente de Compras',
    });
    expect(respostasNaoMapeadas).toEqual([]);
  });

  it('usa o nome da pessoa como razão social quando o formulário não pede empresa', () => {
    const { rawLead } = mapearLeadDoMeta(
      lead([
        { name: 'first_name', values: ['Joana'] },
        { name: 'last_name', values: ['Prado'] },
        { name: 'email', values: ['joana@exemplo.com.br'] },
      ]),
      '777',
    );

    expect(rawLead.razaoSocial).toBe('Joana Prado');
  });

  it('cai pro rótulo com o id do lead quando não há nome nenhum', () => {
    const { rawLead, contato } = mapearLeadDoMeta(
      lead([{ name: 'email', values: ['anonimo@exemplo.com.br'] }]),
      '777',
    );

    expect(rawLead.razaoSocial).toBe('LEAD META 777');
    // Sem nome não há contato — não faz sentido criar Contact sem pessoa.
    expect(contato).toBeUndefined();
  });

  it('não cria contato quando há nome mas nenhuma forma de contato', () => {
    const { contato } = mapearLeadDoMeta(
      lead([{ name: 'full_name', values: ['Joana Prado'] }]),
      '777',
    );

    expect(contato).toBeUndefined();
  });

  it('descarta UF por extenso (coluna é CHAR(2)) e mantém a cidade', () => {
    const { rawLead } = mapearLeadDoMeta(
      lead([
        { name: 'city', values: ['Campinas'] },
        { name: 'state', values: ['São Paulo'] },
      ]),
      '777',
    );

    expect(rawLead.uf).toBeUndefined();
    expect(rawLead.municipio).toBe('Campinas');
  });

  it('aceita CNPJ com máscara e descarta documento de comprimento inválido', () => {
    const comCnpj = mapearLeadDoMeta(
      lead([{ name: 'cnpj', values: ['12.345.678/0001-95'] }]),
      '777',
    );
    expect(comCnpj.rawLead.cnpj).toBe('12345678000195');

    const truncado = mapearLeadDoMeta(
      lead([{ name: 'cnpj', values: ['12345'] }]),
      '777',
    );
    expect(truncado.rawLead.cnpj).toBeUndefined();
  });

  it('reconhece a pergunta de CNPJ do formulário da Gama e completa zero à esquerda', () => {
    // Nome do campo como a Meta manda (texto da pergunta com "_"), e valor
    // como a planilha do Google devolve um número: sem o zero da frente.
    const { rawLead, respostasNaoMapeadas } = mapearLeadDoMeta(
      lead([
        { name: 'qual_o_cnpj_da_sua_empresa?', values: ['1234567000189'] },
        { name: 'full_name', values: ['Joana Prado'] },
      ]),
      '777',
    );

    expect(rawLead.cnpj).toBe('01234567000189');
    // A pergunta de CNPJ é mapeada — não pode aparecer também como
    // "pergunta customizada" na anotação.
    expect(respostasNaoMapeadas).toEqual([]);
  });

  it('aceita qualquer campo cujo nome contenha "cnpj" quando não bate alias', () => {
    const { rawLead } = mapearLeadDoMeta(
      lead([{ name: 'Informe o CNPJ', values: ['12.345.678/0001-95'] }]),
      '777',
    );

    expect(rawLead.cnpj).toBe('12345678000195');
  });

  it('devolve pergunta customizada com pergunta e resposta legíveis', () => {
    // As 3 perguntas reais do formulário da Gama (levantadas na planilha,
    // 2026-09-04) — a Meta troca espaço por "_" na pergunta e nas opções
    // de múltipla escolha.
    const { respostasNaoMapeadas } = mapearLeadDoMeta(
      lead([
        { name: 'full_name', values: ['Joana Prado'] },
        {
          name: 'qual_equipamento_você_procura?',
          values: ['máquina_de_corte_a_laser_para_chapas'],
        },
        {
          name: 'quando_pretende_adquirir_o_equipamento?',
          values: ['imediatamente'],
        },
        {
          name: 'sua_empresa_já_utiliza_máquinas_desse_tipo?',
          values: ['sim,_queremos_ampliar_ou_substituir'],
        },
      ]),
      '777',
    );

    expect(respostasNaoMapeadas).toEqual([
      {
        campo: 'qual_equipamento_você_procura?',
        pergunta: 'Qual equipamento você procura?',
        resposta: 'máquina de corte a laser para chapas',
      },
      {
        campo: 'quando_pretende_adquirir_o_equipamento?',
        pergunta: 'Quando pretende adquirir o equipamento?',
        resposta: 'imediatamente',
      },
      {
        campo: 'sua_empresa_já_utiliza_máquinas_desse_tipo?',
        pergunta: 'Sua empresa já utiliza máquinas desse tipo?',
        resposta: 'sim, queremos ampliar ou substituir',
      },
    ]);
  });

  it('ignora campo sem nome, sem valor ou com valor em branco', () => {
    const { rawLead, respostasNaoMapeadas } = mapearLeadDoMeta(
      lead([
        { name: '', values: ['x'] },
        { name: 'email', values: ['   '] },
        { name: 'full_name', values: [] },
        { name: 'company_name', values: ['Indústria Modelo Ltda'] },
      ]),
      '777',
    );

    expect(rawLead.emails).toBeUndefined();
    expect(rawLead.razaoSocial).toBe('Indústria Modelo Ltda');
    expect(respostasNaoMapeadas).toEqual([]);
  });
});

describe('legivel', () => {
  it('troca "_" por espaço só quando o texto não tem espaço nenhum', () => {
    expect(legivel('máquina_de_corte')).toBe('máquina de corte');
    // Texto livre digitado pela pessoa: o "_" pode ser legítimo.
    expect(legivel('Ref. modelo_X 2000')).toBe('Ref. modelo_X 2000');
  });
});
