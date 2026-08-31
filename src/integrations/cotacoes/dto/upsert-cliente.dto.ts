import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

// Payload do app de cotações (gama-webapp, CrmService.js) — nomes em
// snake_case de propósito, espelhando as colunas da tabela `clientes` de
// lá. Allowlist dupla: o GAS só monta estes campos, e o ValidationPipe
// global (whitelist + forbidNonWhitelisted) rejeita qualquer extra.
export class UpsertClienteDto {
  @Matches(/^\d{14}$/, { message: 'cnpj deve ter exatamente 14 dígitos.' })
  cnpj!: string;

  @IsString()
  @Length(1, 200)
  razao_social!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fantasia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  logradouro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  numero?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  complemento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bairro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cidade?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'uf deve ter 2 letras maiúsculas.' })
  uf?: string;

  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'cep deve ter exatamente 8 dígitos.' })
  cep?: string;

  // Dados estaduais — vão pra companies.custom_fields com as MESMAS chaves
  // que o eGestor usa (egestor-contato-correction.service.ts): indicador_ie
  // é o enum do eGestor (1 = Contribuinte, 2 = Isento de IE, 9 = Não
  // contribuinte). String vazia é válida e significa "limpar o valor" —
  // no write-through do app de cotações o formulário é a verdade.
  @IsOptional()
  @IsIn(['', '1', '2', '9'], {
    message: 'indicador_ie deve ser 1, 2 ou 9 (ou vazio).',
  })
  indicador_ie?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  inscricao_estadual?: string;

  // Presente quando é edição de um cliente já vinculado: atualiza esta
  // company específica (mesmo que o CNPJ tenha sido corrigido no
  // formulário) em vez de casar por CNPJ.
  @IsOptional()
  @IsUUID()
  crm_company_id?: string;
}
