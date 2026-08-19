import { mapearLeadDoMeta } from './meta-lead-mapper';
import type { MetaLeadDetail } from './meta-leads.types';

function lead(
  campos: Array<{ name: string; values: unknown[] }>,
): MetaLeadDetail {
  return { id: 'lead-1', field_data: campos };
}

describe('mapearLeadDoMeta', () => {
  it('mapeia os campos padrão de um formulário de contato', () => {
    const { rawLead, contato, camposNaoMapeados } = mapearLeadDoMeta(
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
      tags: ['meta-leads'],
    });
    expect(contato).toEqual({
      nome: 'Joana Prado',
      email: 'joana@exemplo.com.br',
      telefone: '+55 11 90000-0000',
      cargo: 'Gerente de Compras',
    });
    expect(camposNaoMapeados).toEqual([]);
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

  it('reporta perguntas customizadas em vez de descartá-las em silêncio', () => {
    const { camposNaoMapeados } = mapearLeadDoMeta(
      lead([
        { name: 'full_name', values: ['Joana Prado'] },
        { name: 'Qual produto te interessa?', values: ['Linha industrial'] },
      ]),
      '777',
    );

    expect(camposNaoMapeados).toEqual(['qual produto te interessa?']);
  });

  it('ignora campo sem nome, sem valor ou com valor em branco', () => {
    const { rawLead, camposNaoMapeados } = mapearLeadDoMeta(
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
    expect(camposNaoMapeados).toEqual([]);
  });
});
