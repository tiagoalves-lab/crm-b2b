import ExcelJS from 'exceljs';
import {
  CONTACTS_TEMPLATE_COLUMNS,
  contactsTemplateHeaderLine,
  parseContactsSpreadsheet,
} from './contacts-spreadsheet-import.util';

// Dados 100% fictícios (nunca real de empresa/pessoa — ver docs/seguranca.md).
const HEADER = contactsTemplateHeaderLine().split('\t').join(',');

type Key = (typeof CONTACTS_TEMPLATE_COLUMNS)[number]['key'];

// Monta uma linha por NOME de coluna em vez de posição — evita que um
// teste quebre silenciosamente (valor caindo na coluna errada) sempre
// que uma coluna nova entrar no meio do modelo (ver Tags, 2026-08-06).
function row(values: Partial<Record<Key, string>>): string {
  return CONTACTS_TEMPLATE_COLUMNS.map((c) => values[c.key] ?? '').join(',');
}

function csvBuffer(rows: string[]): Buffer {
  return Buffer.from([HEADER, ...rows].join('\n'), 'utf8');
}

describe('parseContactsSpreadsheet', () => {
  it('agrupa duas linhas do mesmo CNPJ em uma empresa com dois contatos', async () => {
    const buffer = csvBuffer([
      row({
        cnpj: '11.222.333/0001-44',
        razaoSocial: 'FICTICIA METALURGICA LTDA',
        fantasia: 'METAL FICTICIA',
        cidade: 'PORTO FICTICIO',
        uf: 'RS',
        cnae: '2511000',
        porte: 'GRANDE',
        situacao: 'ATIVA',
        abertura: '20140526',
        socios: 'FULANO DE TAL',
        importador: 'Não',
        contatoNome: 'Jonas Ficticio',
        contatoCargo: 'Financeiro',
        contatoEmail: 'jonas@ficticia.example.com',
        contatoTelefone: '51999990000',
        contatoDecisor: 'Sim',
      }),
      row({
        cnpj: '11.222.333/0001-44',
        razaoSocial: 'FICTICIA METALURGICA LTDA',
        contatoNome: 'Maria Ficticia',
        contatoCargo: 'Compras',
        contatoEmail: 'maria@ficticia.example.com',
        contatoTelefone: '51999991111',
        contatoDecisor: 'Não',
      }),
    ]);

    const { groups, errors } = await parseContactsSpreadsheet(
      buffer,
      'contatos.csv',
    );

    expect(errors).toEqual([]);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.cnpj).toBe('11222333000144');
    expect(group.razaoSocial).toBe('FICTICIA METALURGICA LTDA');
    expect(group.uf).toBe('RS');
    expect(group.porte).toBe('GRANDE');
    expect(group.socios).toEqual(['FULANO DE TAL']);
    expect(group.contacts).toHaveLength(2);
    expect(group.contacts[0]).toMatchObject({
      nome: 'Jonas Ficticio',
      decisor: true,
    });
    expect(group.contacts[1]).toMatchObject({
      nome: 'Maria Ficticia',
      decisor: false,
    });
  });

  // Coluna "Tags" (2026-08-06, pedido direto do usuário — não existia no
  // modelo padrão de importação) — mesmo separador "|" de Sócios (QSA).
  it('lê a coluna Tags separada por "|"', async () => {
    const buffer = csvBuffer([
      row({
        cnpj: '99.888.777/0001-11',
        razaoSocial: 'EMPRESA COM TAGS LTDA',
        tags: 'quente | follow-up | prioritario',
        contatoNome: 'Jonas Ficticio',
      }),
    ]);

    const { groups, errors } = await parseContactsSpreadsheet(
      buffer,
      'contatos.csv',
    );

    expect(errors).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tags).toEqual(['quente', 'follow-up', 'prioritario']);
  });

  it('grupo sem coluna Tags preenchida fica com tags undefined', async () => {
    const buffer = csvBuffer([
      row({
        cnpj: '99.888.777/0001-22',
        razaoSocial: 'EMPRESA SEM TAGS LTDA',
        contatoNome: 'Jonas Ficticio',
      }),
    ]);

    const { groups, errors } = await parseContactsSpreadsheet(
      buffer,
      'contatos.csv',
    );

    expect(errors).toEqual([]);
    expect(groups[0].tags).toBeUndefined();
  });

  it('rejeita planilha com cabeçalho fora do modelo padrão (coluna faltando)', async () => {
    const buffer = Buffer.from(
      'CNPJ,Razão Social,Contato Nome\n11.222.333/0001-44,Empresa Ficticia,Jonas Ficticio',
      'utf8',
    );
    await expect(
      parseContactsSpreadsheet(buffer, 'contatos.csv'),
    ).rejects.toThrow(/modelo padrão/i);
  });

  it('rejeita planilha com coluna extra não reconhecida', async () => {
    const buffer = Buffer.from(`${HEADER},Coluna Extra\n`, 'utf8');
    await expect(
      parseContactsSpreadsheet(buffer, 'contatos.csv'),
    ).rejects.toThrow(/não reconhecida/i);
  });

  it('reporta erro de linha quando falta CNPJ, sem derrubar as outras', async () => {
    const buffer = csvBuffer([
      row({ razaoSocial: 'Empresa Sem Cnpj', contatoNome: 'Jonas Ficticio' }),
      row({
        cnpj: '22.333.444/0001-55',
        razaoSocial: 'Empresa Com Cnpj',
        contatoNome: 'Maria Ficticia',
      }),
    ]);
    const { groups, errors } = await parseContactsSpreadsheet(
      buffer,
      'contatos.csv',
    );
    expect(groups).toHaveLength(1);
    expect(errors).toEqual([
      { row: 2, reason: 'CNPJ vazio ou inválido (precisa ter 14 dígitos).' },
    ]);
  });

  it('reporta erro de linha quando falta Contato Nome', async () => {
    const buffer = csvBuffer([
      row({ cnpj: '33.444.555/0001-66', razaoSocial: 'Empresa Ficticia' }),
    ]);
    const { groups, errors } = await parseContactsSpreadsheet(
      buffer,
      'contatos.csv',
    );
    expect(groups).toHaveLength(0);
    expect(errors).toEqual([
      {
        row: 2,
        reason: 'Contato Nome vazio — toda linha precisa de um contato.',
      },
    ]);
  });

  it('reporta erro de linha quando o e-mail do contato é inválido', async () => {
    const buffer = csvBuffer([
      row({
        cnpj: '44.555.666/0001-77',
        razaoSocial: 'Empresa Ficticia',
        contatoNome: 'Jonas Ficticio',
        contatoEmail: 'nao-e-um-email',
      }),
    ]);
    const { groups, errors } = await parseContactsSpreadsheet(
      buffer,
      'contatos.csv',
    );
    expect(groups).toHaveLength(0);
    expect(errors).toEqual([{ row: 2, reason: 'Contato Email inválido.' }]);
  });

  it('ignora linhas totalmente em branco no fim da planilha', async () => {
    const buffer = csvBuffer([
      row({
        cnpj: '55.666.777/0001-88',
        razaoSocial: 'Empresa Ficticia',
        contatoNome: 'Jonas Ficticio',
      }),
      row({}),
    ]);
    const { groups, errors } = await parseContactsSpreadsheet(
      buffer,
      'contatos.csv',
    );
    expect(groups).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('lê o mesmo formato em XLSX de verdade (round-trip via exceljs)', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Contatos');
    sheet.addRow(contactsTemplateHeaderLine().split('\t'));
    const xlsxRow: Partial<Record<Key, string>> = {
      cnpj: '66.777.888/0001-99',
      razaoSocial: 'Empresa Ficticia Sete',
      uf: 'SC',
      contatoNome: 'Jonas Ficticio',
      contatoCargo: 'Diretor',
      contatoEmail: 'jonas@ficticia.example.com',
      contatoTelefone: '48999990000',
      contatoDecisor: 'Sim',
    };
    sheet.addRow(CONTACTS_TEMPLATE_COLUMNS.map((c) => xlsxRow[c.key] ?? ''));
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const { groups, errors } = await parseContactsSpreadsheet(
      buffer,
      'contatos.xlsx',
    );
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].contacts[0]).toMatchObject({
      nome: 'Jonas Ficticio',
      decisor: true,
    });
  });
});
