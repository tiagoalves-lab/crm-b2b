import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TrelloComentarioDto } from './trello-comentario.dto';
import {
  TRELLO_COMENTARIOS_MAX,
  TRELLO_DESCRICAO_MAX,
} from './trello-vinculo.dto';

// Botão "Sincronizar" da tela Trello do app de cotações: reespelha o
// chat do cartão no card do CRM. Só mensagem — a lista de itens e os
// dados da oportunidade não são tocados (quem editar o card no CRM não
// perde o que fez por causa de um sync).
export class TrelloComentariosDto {
  @Matches(/^[0-9a-f]{24}$/i, {
    message: 'card_id deve ser um id do Trello (24 caracteres hexadecimais).',
  })
  card_id!: string;

  @IsArray()
  @ArrayMaxSize(TRELLO_COMENTARIOS_MAX)
  @ValidateNested({ each: true })
  @Type(() => TrelloComentarioDto)
  comentarios!: TrelloComentarioDto[];

  // Descrição do cartão, aplicada SÓ quando a do card está vazia — é o
  // caminho de correção das oportunidades criadas antes de a descrição
  // viajar no cadastro. Sincronizar continua sem sobrescrever nada que
  // tenha sido escrito no CRM.
  @IsOptional()
  @IsString()
  @MaxLength(TRELLO_DESCRICAO_MAX)
  descricao?: string;
}
