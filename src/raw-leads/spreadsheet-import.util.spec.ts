import ExcelJS from 'exceljs';
import { parseLeadsSpreadsheet } from './spreadsheet-import.util';

// Dados 100% fictícios (nunca real de empresa/pessoa — ver docs/seguranca.md)
// no mesmo formato do "Crawler CNPJ Gama": CNPJ,Empresa,Fantasia,Cidade,UF,
// Telefone,Telefone 2,Email (Receita),Porte,Socios (QSA),CNAE,Divisao,Abertura
const CSV_HEADER =
  'CNPJ,Empresa,Fantasia,Cidade,UF,Telefone,Telefone 2,Email (Receita),Porte,Socios (QSA),CNAE,Divisao,Abertura';

function csvBuffer(rows: string[]): Buffer {
  return Buffer.from([CSV_HEADER, ...rows].join('\n'), 'utf8');
}

describe('parseLeadsSpreadsheet', () => {
  it('mapeia uma linha completa do formato do crawler (CSV)', async () => {
    const buffer = csvBuffer([
      '11.222.333/0001-44,FICTICIA METALURGICA LTDA,METAL FICTICIA,PORTO FICTICIO,RS,5133334444,000000000000,contato@ficticia.example.com,EPP,FULANO DE TAL | CICLANO DA SILVA,2511000,25,20140526',
    ]);

    const { rows, errors } = await parseLeadsSpreadsheet(buffer, 'leads.csv');

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    const { dto } = rows[0];
    expect(dto.razaoSocial).toBe('FICTICIA METALURGICA LTDA');
    expect(dto.cnpj).toBe('11222333000144');
    expect(dto.fantasia).toBe('METAL FICTICIA');
    expect(dto.municipio).toBe('PORTO FICTICIO');
    expect(dto.uf).toBe('RS');
    // Telefone 2 é lixo (só zeros) — só o primeiro entra.
    expect(dto.fones).toEqual(['5133334444']);
    expect(dto.emails).toEqual(['contato@ficticia.example.com']);
    expect(dto.porte).toBe('PEQUENO'); // EPP normalizado
    expect(dto.socios).toEqual(['FULANO DE TAL', 'CICLANO DA SILVA']);
    expect(dto.cnaePrincipal).toBe('2511000');
    expect(dto.dtAbertura).toBe('2014-05-26');
    expect(dto.situacao).toBe('ATIVA'); // default, planilha não tem a coluna
    expect(dto.importador).toBe(false);
  });

  it('normaliza Porte "Demais" para MÉDIO', async () => {
    const buffer = csvBuffer([
      '22.333.444/0001-55,OUTRA FICTICIA LTDA,,CIDADE FICTICIA,SC,,,,Demais,,2599399,25,',
    ]);
    const { rows } = await parseLeadsSpreadsheet(buffer, 'leads.csv');
    expect(rows[0].dto.porte).toBe('MÉDIO');
  });

  it('descarta telefone placeholder (só zeros) e e-mail inválido', async () => {
    const buffer = csvBuffer([
      '33.444.555/0001-66,TERCEIRA FICTICIA LTDA,,CIDADE FICTICIA,PR,000000000000,,nao-e-um-email,EPP,,2512800,25,',
    ]);
    const { rows } = await parseLeadsSpreadsheet(buffer, 'leads.csv');
    expect(rows[0].dto.fones).toBeUndefined();
    expect(rows[0].dto.emails).toBeUndefined();
  });

  it('descarta fantasia placeholder ("------")', async () => {
    const buffer = csvBuffer([
      '44.555.666/0001-77,QUARTA FICTICIA LTDA,------,CIDADE FICTICIA,MG,,,,EPP,,2511000,25,',
    ]);
    const { rows } = await parseLeadsSpreadsheet(buffer, 'leads.csv');
    expect(rows[0].dto.fantasia).toBeUndefined();
  });

  it('reporta erro por linha quando falta razão social, sem derrubar as outras linhas', async () => {
    const buffer = csvBuffer([
      '55.666.777/0001-88,,,,SP,,,,,,,,',
      '66.777.888/0001-99,QUINTA FICTICIA LTDA,,CIDADE FICTICIA,SP,,,,EPP,,2511000,25,',
    ]);
    const { rows, errors } = await parseLeadsSpreadsheet(buffer, 'leads.csv');
    expect(rows).toHaveLength(1);
    expect(rows[0].dto.razaoSocial).toBe('QUINTA FICTICIA LTDA');
    expect(errors).toEqual([{ row: 2, reason: 'Razão social/Empresa vazia.' }]);
  });

  it('ignora linhas totalmente em branco no fim da planilha', async () => {
    const buffer = csvBuffer([
      '77.888.999/0001-00,SEXTA FICTICIA LTDA,,CIDADE FICTICIA,RJ,,,,EPP,,2511000,25,',
      ',,,,,,,,,,,,',
    ]);
    const { rows, errors } = await parseLeadsSpreadsheet(buffer, 'leads.csv');
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('rejeita planilha sem coluna de razão social/empresa', async () => {
    const buffer = Buffer.from('CNPJ,Cidade\n11.222.333/0001-44,PORTO FICTICIO', 'utf8');
    await expect(parseLeadsSpreadsheet(buffer, 'leads.csv')).rejects.toThrow(
      /razão social/i,
    );
  });

  it('lê o mesmo formato em XLSX de verdade (round-trip via exceljs)', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Leads');
    sheet.addRow(CSV_HEADER.split(','));
    sheet.addRow([
      '88.999.000/0001-11',
      'SETIMA FICTICIA LTDA',
      '',
      'CIDADE FICTICIA',
      'RS',
      '5133335555',
      '',
      'setima@ficticia.example.com',
      'EPP',
      '',
      '2511000',
      '25',
      '20200101',
    ]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const { rows, errors } = await parseLeadsSpreadsheet(buffer, 'leads.xlsx');
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].dto.razaoSocial).toBe('SETIMA FICTICIA LTDA');
    expect(rows[0].dto.porte).toBe('PEQUENO');
  });
});
