import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Relatório "Contatos" (tela Relatórios, 2026-09-28). Diferente dos outros
// relatórios, o período é OPCIONAL: a pergunta normal aqui é "me dá a
// agenda inteira", e a data de cadastro só entra quando a pessoa quer
// "quem entrou este mês". Sem inicio/fim = qualquer data.
export class ContatosQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  inicio?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  fim?: string;

  // Dono do contato (quem cadastrou). Só estreita o que o papel já
  // enxerga.
  @IsOptional()
  @IsUUID()
  usuarioId?: string;

  @IsOptional()
  @IsIn(['sim', 'nao'])
  decisor?: 'sim' | 'nao';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  empresa?: string;

  // Parte do nome, e-mail ou telefone do contato.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contato?: string;
}
