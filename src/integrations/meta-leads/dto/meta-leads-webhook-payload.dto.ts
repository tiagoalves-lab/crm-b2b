import { Type } from 'class-transformer';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// Envelope do webhook da Meta. Validação deliberadamente frouxa no miolo
// (`value` é `IsObject`, não uma classe com campo a campo): o
// ValidationPipe global roda com `forbidNonWhitelisted: true`, então tipar
// `value` estritamente faria a Meta acrescentar um campo novo qualquer
// (ela faz isso sem aviso) e o CRM passar a responder 400 pra TODO evento —
// perda de lead real por causa de um campo que nem usamos. Quem sabe ler o
// `value` é MetaLeadsWebhookService, defensivamente.
export class MetaLeadsChangeDto {
  @IsString()
  field!: string;

  @IsObject()
  value!: Record<string, unknown>;
}

export class MetaLeadsEntryDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  time?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetaLeadsChangeDto)
  changes?: MetaLeadsChangeDto[];
}

export class MetaLeadsWebhookPayloadDto {
  // "page" pros eventos de Lead Ads — outros objetos (instagram, user...)
  // podem chegar se a assinatura for ampliada; o service ignora o que não
  // for `leadgen`, em vez de rejeitar aqui.
  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetaLeadsEntryDto)
  entry?: MetaLeadsEntryDto[];
}
