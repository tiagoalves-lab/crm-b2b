import { IsArray, IsString } from 'class-validator';

// Corpo do POST /contacts (ContactBulkController#listByCompanyIds) — não
// @IsUUID each de propósito: um id malformado na lista não deve derrubar
// a requisição inteira (é uma prévia read-only, filtrada no controller
// via UUID_RE), então a validação aqui só garante "array de strings",
// igual o comportamento antigo baseado em query string.
export class ListContactsByCompanyIdsDto {
  @IsArray()
  @IsString({ each: true })
  companyIds!: string[];
}
