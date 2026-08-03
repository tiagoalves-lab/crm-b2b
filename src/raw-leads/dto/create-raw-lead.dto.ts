import { LeadFonte } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

// Import manual (via form) do lead bruto — a ingestão automática por
// crawler/Apify/Comex Stat é fase seguinte, fora de escopo desta rodada
// (SPEC-CRM-GAMA.md §9). O score é calculado no service, nunca recebido
// do cliente.
export class CreateRawLeadDto {
  @IsString()
  @MaxLength(255)
  razaoSocial!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  cnaePrincipal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cnaeDescricao?: string;

  // GRANDE/MÉDIO/PEQUENO — texto livre por design (mesmo padrão do
  // protótipo), não é enum no banco.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  porte?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  uf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  municipio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  situacao?: string;

  @IsOptional()
  @IsBoolean()
  importador?: boolean;

  @IsOptional()
  @IsEnum(LeadFonte)
  fonte?: LeadFonte;

  // Campos abaixo não existem em RawLead — só alimentam a Company criada
  // junto (ver RawLeadService#create). Vieram junto com a importação por
  // planilha (SPEC além do §4.4 original), mas o form manual também pode
  // preencher se quiser.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fantasia?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fones?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  socios?: string[];

  @IsOptional()
  @IsDateString()
  dtAbertura?: string;
}
