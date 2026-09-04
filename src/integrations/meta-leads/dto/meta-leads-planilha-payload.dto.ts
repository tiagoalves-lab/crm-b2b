import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Uma linha da aba "Query CRM" da planilha do gestor de tráfego, como o
// script scripts/planilha-meta-leads.gs manda: `id` é a coluna "id" da
// planilha (o id que a Meta dá ao lead, com o prefixo "l:") e `campos` é
// cabeçalho → valor de TODAS as colunas da linha, sem tratamento. Quem
// entende o que cada coluna é (metadado do anúncio × resposta do
// formulário) é o MetaLeadsPlanilhaService — assim uma coluna nova na
// planilha não exige mexer no script, só no CRM.
//
// `campos` é `IsObject` (não classe campo a campo) pelo mesmo motivo do
// `value` do MetaLeadsWebhookPayloadDto: o ValidationPipe global roda com
// `forbidNonWhitelisted`, e tipar estrito faria uma coluna nova na
// planilha virar 400 em TODA linha.
export class MetaLeadsPlanilhaLinhaDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsObject()
  campos!: Record<string, unknown>;
}

export class MetaLeadsPlanilhaPayloadDto {
  // Rótulo livre de quem mandou ("planilha") — só auditoria.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  origem?: string;

  // O script manda em lotes de 50; 100 é teto de segurança (corpo JSON
  // fica bem abaixo do limite de 100kb do Express).
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MetaLeadsPlanilhaLinhaDto)
  linhas!: MetaLeadsPlanilhaLinhaDto[];
}
