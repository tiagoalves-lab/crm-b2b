import { Readable } from 'stream';
import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { CreateRawLeadDto } from './dto/create-raw-lead.dto';

export interface RowError {
  row: number;
  reason: string;
}

export interface ParsedSpreadsheet {
  rows: Array<{ row: number; dto: CreateRawLeadDto }>;
  errors: RowError[];
}

// DE-PARA: cabeçalho da planilha (normalizado — sem acento/espaço/caixa)
// → campo canônico. Cobre o formato do "Crawler CNPJ Gama" (Empresa,
// Fantasia, Cidade, UF, Telefone, Telefone 2, Email (Receita), Porte,
// Socios (QSA), CNAE, Divisao, Abertura) e aceita alguns sinônimos óbvios
// pra não travar em planilhas escritas à mão com nomes ligeiramente
// diferentes.
type CanonicalField =
  | 'cnpj'
  | 'razaoSocial'
  | 'fantasia'
  | 'cidade'
  | 'uf'
  | 'telefone1'
  | 'telefone2'
  | 'email'
  | 'porte'
  | 'socios'
  | 'cnae'
  | 'abertura'
  | 'situacao'
  | 'importador';

const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  cnpj: ['cnpj'],
  razaoSocial: ['empresa', 'razaosocial', 'nome', 'nomeempresarial'],
  fantasia: ['fantasia', 'nomefantasia'],
  cidade: ['cidade', 'municipio'],
  uf: ['uf', 'estado'],
  telefone1: ['telefone', 'fone', 'telefone1', 'fone1'],
  telefone2: ['telefone2', 'fone2'],
  email: ['emailreceita', 'email', 'emails', 'e-mail'],
  porte: ['porte'],
  socios: ['sociosqsa', 'socios', 'qsa'],
  cnae: ['cnae', 'cnaeprincipal'],
  abertura: ['abertura', 'dataabertura', 'dtabertura'],
  situacao: ['situacao', 'situacaocadastral'],
  importador: ['importador'],
};

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function buildHeaderIndex(
  headers: string[],
): Partial<Record<CanonicalField, number>> {
  const normalized = headers.map((h) => normalizeHeader(h ?? ''));
  const index: Partial<Record<CanonicalField, number>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [CanonicalField, string[]]
  >) {
    const col = normalized.findIndex((h) => aliases.includes(h));
    if (col >= 0) index[field] = col;
  }
  return index;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'object' &&
    'text' in (value as Record<string, unknown>)
  ) {
    return String((value as { text: unknown }).text ?? '').trim();
  }
  return String(value).trim();
}

// Placeholder que o crawler grava quando não achou telefone de verdade
// (tudo zero) — não vale a pena persistir.
export function isJunkPhone(digits: string): boolean {
  return digits.length < 8 || /^0+$/.test(digits);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePorte(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const upper = normalizeHeader(value).toUpperCase(); // reaproveita o strip de acento
  if (upper === 'EPP') return 'PEQUENO';
  if (upper === 'DEMAIS') return 'MÉDIO';
  if (upper === 'GRANDE' || upper === 'MEDIO' || upper === 'PEQUENO') {
    return upper === 'MEDIO' ? 'MÉDIO' : upper;
  }
  return value;
}

// Aceita "20140526" (formato do crawler) ou já-ISO ("2014-05-26").
export function normalizeAbertura(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    const iso = `${year}-${month}-${day}`;
    return Number.isNaN(Date.parse(iso)) ? undefined : iso;
  }
  return undefined;
}

export async function loadWorksheet(
  buffer: Buffer,
  filename: string,
): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(filename);
  if (isCsv) {
    return workbook.csv.read(Readable.from(buffer));
  }
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new BadRequestException('Planilha vazia ou sem nenhuma aba.');
  }
  return worksheet;
}

export async function parseLeadsSpreadsheet(
  buffer: Buffer,
  filename: string,
): Promise<ParsedSpreadsheet> {
  const worksheet = await loadWorksheet(buffer, filename);

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value);
  });

  const index = buildHeaderIndex(headers);
  if (index.razaoSocial === undefined) {
    throw new BadRequestException(
      'Planilha sem coluna de razão social (esperado "Empresa" ou "Razão Social").',
    );
  }

  const rows: ParsedSpreadsheet['rows'] = [];
  const errors: RowError[] = [];

  const col = (field: CanonicalField, row: ExcelJS.Row): string =>
    index[field] !== undefined
      ? cellText(row.getCell(index[field] + 1).value)
      : '';

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header

    const razaoSocial = col('razaoSocial', row);
    if (!razaoSocial) {
      const hasAnyValue = headers.some(
        (_, colIndex) => cellText(row.getCell(colIndex + 1).value) !== '',
      );
      if (!hasAnyValue) return; // linha em branco no fim da planilha — ignora silenciosamente
      errors.push({ row: rowNumber, reason: 'Razão social/Empresa vazia.' });
      return;
    }

    const cnpjDigits = col('cnpj', row).replace(/\D/g, '');
    const fones = [col('telefone1', row), col('telefone2', row)]
      .map((f) => f.replace(/\D/g, ''))
      .filter((f) => f && !isJunkPhone(f));
    const emailRaw = col('email', row).toLowerCase();
    const emails = EMAIL_RE.test(emailRaw) ? [emailRaw] : [];
    const fantasiaRaw = col('fantasia', row);
    const fantasia = /^[-\s]*$/.test(fantasiaRaw) ? undefined : fantasiaRaw;
    const socios = col('socios', row)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const situacaoRaw = col('situacao', row).toUpperCase();
    const importadorRaw = col('importador', row).toLowerCase();

    const dto: CreateRawLeadDto = {
      razaoSocial,
      cnpj: cnpjDigits || undefined,
      cnaePrincipal: col('cnae', row) || undefined,
      porte: normalizePorte(col('porte', row)),
      uf: col('uf', row).toUpperCase().slice(0, 2) || undefined,
      municipio: col('cidade', row) || undefined,
      // Sem coluna de situação cadastral na planilha, assume ATIVA — decisão
      // do usuário (2026-08-01): o crawler já filtra só empresas ativas na
      // Receita antes de gerar a planilha, então não faz sentido penalizar
      // o score de 100% dos leads importados por falta desse dado.
      situacao: situacaoRaw || 'ATIVA',
      importador: ['sim', 'true', '1', 'x'].includes(importadorRaw),
      fantasia,
      emails: emails.length ? emails : undefined,
      fones: fones.length ? fones : undefined,
      socios: socios.length ? socios : undefined,
      dtAbertura: normalizeAbertura(col('abertura', row)),
    };

    rows.push({ row: rowNumber, dto });
  });

  return { rows, errors };
}
