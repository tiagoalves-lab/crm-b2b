import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

// Completar/corrigir o cadastro de um lead ainda em triagem (pedido do
// usuário, 2026-09-04): o lead que chega do formulário do Meta vem sem
// CNPJ, e é na ficha da Prospecção que o vendedor preenche — o frontend
// consulta a Receita (BrasilAPI, mesma busca do "Novo lead") e manda tudo
// junto: CNPJ, razão social, CNAE, porte, situação, cidade/UF. Todo campo
// opcional: o que não vier fica como está. `cnpj: null` limpa.
//
// Mesmos limites de CreateRawLeadDto — é o mesmo dado, só chegando depois.
export class UpdateLeadCadastroDto {
  @IsOptional()
  @ValidateIf((o: UpdateLeadCadastroDto) => o.cnpj !== null)
  @IsString()
  @MaxLength(20)
  cnpj?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  razaoSocial?: string;

  // Advisory — mesmo campo/mesmo motivo de CreateRawLeadDto: quando quem
  // chama já sabe (a busca por CNPJ devolve a razão social limpa), confia
  // direto; omitido, o service detecta a partir de razaoSocial.
  @IsOptional()
  @IsBoolean()
  emRecuperacaoJudicial?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  cnaePrincipal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cnaeDescricao?: string;

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
}
