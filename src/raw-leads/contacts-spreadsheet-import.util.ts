import { BadRequestException } from '@nestjs/common';
import type ExcelJS from 'exceljs';
import {
  cellText,
  EMAIL_RE,
  isJunkPhone,
  loadWorksheet,
  normalizeAbertura,
  normalizeHeader,
  normalizePorte,
} from './spreadsheet-import.util';

export interface RowError {
  row: number;
  reason: string;
}

export interface ContactRow {
  row: number;
  nome: string;
  cargo?: string;
  email?: string;
  telefone?: string;
  decisor: boolean;
}

export interface CompanyGroup {
  firstRow: number;
  cnpj: string;
  razaoSocial: string;
  fantasia?: string;
  municipio?: string;
  uf?: string;
  cnaePrincipal?: string;
  porte?: string;
  situacao: string;
  importador: boolean;
  socios?: string[];
  tags?: string[];
  dtAbertura?: string;
  contacts: ContactRow[];
}

export interface ParsedContactsSpreadsheet {
  groups: CompanyGroup[];
  errors: RowError[];
}

// Modelo padrão FIXO (diferente do parser tolerante de spreadsheet-import.util.ts,
// que aceita sinônimos de cabeçalho do "Crawler CNPJ Gama"): aqui o pedido do
// usuário (2026-08-03) foi um layout rígido pra colar via Ctrl+C/Ctrl+V, que
// dispara erro se não corresponder — então cada campo tem UM único nome de
// cabeçalho aceito (normalizado: sem acento/espaço/caixa), sem aliases.
type TemplateKey =
  | 'cnpj'
  | 'razaoSocial'
  | 'fantasia'
  | 'cidade'
  | 'uf'
  | 'cnae'
  | 'porte'
  | 'situacao'
  | 'abertura'
  | 'socios'
  | 'importador'
  | 'tags'
  | 'contatoNome'
  | 'contatoCargo'
  | 'contatoEmail'
  | 'contatoTelefone'
  | 'contatoDecisor';

export const CONTACTS_TEMPLATE_COLUMNS: Array<{
  key: TemplateKey;
  header: string;
}> = [
  { key: 'cnpj', header: 'CNPJ' },
  { key: 'razaoSocial', header: 'Razão Social' },
  { key: 'fantasia', header: 'Fantasia' },
  { key: 'cidade', header: 'Cidade' },
  { key: 'uf', header: 'UF' },
  { key: 'cnae', header: 'CNAE' },
  { key: 'porte', header: 'Porte' },
  { key: 'situacao', header: 'Situação Cadastral' },
  { key: 'abertura', header: 'Abertura' },
  { key: 'socios', header: 'Sócios (QSA)' },
  { key: 'importador', header: 'Importador' },
  // Tags livres da Prospecção (RawLead.tags, pedido do usuário,
  // 2026-08-06) — mesmo separador "|" de Sócios (QSA) acima, por
  // consistência dentro deste mesmo modelo.
  { key: 'tags', header: 'Tags' },
  { key: 'contatoNome', header: 'Contato Nome' },
  { key: 'contatoCargo', header: 'Contato Cargo' },
  { key: 'contatoEmail', header: 'Contato Email' },
  { key: 'contatoTelefone', header: 'Contato Telefone' },
  { key: 'contatoDecisor', header: 'Contato Decisor' },
];

export function contactsTemplateHeaderLine(): string {
  return CONTACTS_TEMPLATE_COLUMNS.map((c) => c.header).join('\t');
}

function validateTemplateHeaders(headers: string[]): void {
  const found = new Set(headers.map(normalizeHeader).filter(Boolean));
  const expectedByNorm = new Map(
    CONTACTS_TEMPLATE_COLUMNS.map((c) => [normalizeHeader(c.header), c.header]),
  );

  const missing = [...expectedByNorm.entries()]
    .filter(([norm]) => !found.has(norm))
    .map(([, header]) => header);
  const unexpected = headers.filter((h) => {
    const norm = normalizeHeader(h);
    return norm && !expectedByNorm.has(norm);
  });

  if (missing.length > 0 || unexpected.length > 0) {
    const parts: string[] = [];
    if (missing.length) parts.push(`faltando: ${missing.join(', ')}`);
    if (unexpected.length)
      parts.push(`não reconhecida(s): ${unexpected.join(', ')}`);
    throw new BadRequestException(
      `Planilha não segue o modelo padrão (${parts.join(' · ')}). ` +
        `Cabeçalho esperado: ${contactsTemplateHeaderLine().replace(/\t/g, ' | ')}.`,
    );
  }
}

function buildTemplateHeaderIndex(
  headers: string[],
): Partial<Record<TemplateKey, number>> {
  const keyByNorm = new Map(
    CONTACTS_TEMPLATE_COLUMNS.map((c) => [normalizeHeader(c.header), c.key]),
  );
  const index: Partial<Record<TemplateKey, number>> = {};
  headers.forEach((h, i) => {
    const key = keyByNorm.get(normalizeHeader(h));
    if (key) index[key] = i;
  });
  return index;
}

const TRUTHY = ['sim', 'true', '1', 'x'];

export async function parseContactsSpreadsheet(
  buffer: Buffer,
  filename: string,
): Promise<ParsedContactsSpreadsheet> {
  const worksheet = await loadWorksheet(buffer, filename);

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value);
  });

  validateTemplateHeaders(headers);
  const index = buildTemplateHeaderIndex(headers);

  const col = (key: TemplateKey, row: ExcelJS.Row): string =>
    index[key] !== undefined ? cellText(row.getCell(index[key] + 1).value) : '';

  const groups = new Map<string, CompanyGroup>();
  const errors: RowError[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header

    const hasAnyValue = headers.some(
      (_, colIndex) => cellText(row.getCell(colIndex + 1).value) !== '',
    );
    if (!hasAnyValue) return; // linha em branco no fim da planilha — ignora

    const cnpjDigits = col('cnpj', row).replace(/\D/g, '');
    const razaoSocial = col('razaoSocial', row);
    const contatoNome = col('contatoNome', row);

    if (cnpjDigits.length !== 14) {
      errors.push({
        row: rowNumber,
        reason: 'CNPJ vazio ou inválido (precisa ter 14 dígitos).',
      });
      return;
    }
    if (!razaoSocial) {
      errors.push({ row: rowNumber, reason: 'Razão Social vazia.' });
      return;
    }
    if (!contatoNome) {
      errors.push({
        row: rowNumber,
        reason: 'Contato Nome vazio — toda linha precisa de um contato.',
      });
      return;
    }

    const contatoEmailRaw = col('contatoEmail', row).toLowerCase();
    if (contatoEmailRaw && !EMAIL_RE.test(contatoEmailRaw)) {
      errors.push({ row: rowNumber, reason: 'Contato Email inválido.' });
      return;
    }

    let group = groups.get(cnpjDigits);
    if (!group) {
      const fantasiaRaw = col('fantasia', row);
      const socios = col('socios', row)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const tags = col('tags', row)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const importadorRaw = col('importador', row).toLowerCase();

      group = {
        firstRow: rowNumber,
        cnpj: cnpjDigits,
        razaoSocial,
        fantasia: /^[-\s]*$/.test(fantasiaRaw)
          ? undefined
          : fantasiaRaw || undefined,
        municipio: col('cidade', row) || undefined,
        uf: col('uf', row).toUpperCase().slice(0, 2) || undefined,
        cnaePrincipal: col('cnae', row) || undefined,
        porte: normalizePorte(col('porte', row)),
        situacao: col('situacao', row).toUpperCase() || 'ATIVA',
        importador: TRUTHY.includes(importadorRaw),
        socios: socios.length ? socios : undefined,
        tags: tags.length ? tags : undefined,
        dtAbertura: normalizeAbertura(col('abertura', row)),
        contacts: [],
      };
      groups.set(cnpjDigits, group);
    }

    const telefoneDigits = col('contatoTelefone', row).replace(/\D/g, '');
    const decisorRaw = col('contatoDecisor', row).toLowerCase();

    group.contacts.push({
      row: rowNumber,
      nome: contatoNome,
      cargo: col('contatoCargo', row) || undefined,
      email: contatoEmailRaw || undefined,
      telefone:
        telefoneDigits && !isJunkPhone(telefoneDigits)
          ? telefoneDigits
          : undefined,
      decisor: TRUTHY.includes(decisorRaw),
    });
  });

  return { groups: Array.from(groups.values()), errors };
}
