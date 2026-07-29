import { PessoaTipo } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  // Default (não informado): quem está criando. Se informado, precisa ser
  // Membership ativo do mesmo workspace (checado no service).
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @IsUUID()
  parentCompanyId?: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  // Cadastro completo (ex-Contact, dobrado em Company) — todos opcionais,
  // "name" continua sendo o único campo obrigatório. Preenchidos manualmente
  // ou via busca por CNPJ (CompanyController#lookupCnpj).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  razaoSocial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fantasia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nomeParaContato?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cpfCnpj?: string;

  @IsOptional()
  @IsEnum(PessoaTipo)
  tipo?: PessoaTipo;

  @IsOptional()
  @IsDateString()
  dtNasc?: string;

  @IsOptional()
  @IsDateString()
  dtCad?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fones?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  logradouro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  numero?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  complemento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bairro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  cep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cidade?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  uf?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
