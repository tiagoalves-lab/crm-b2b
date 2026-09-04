import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ITEM_NAME_MAX,
  ITEMS_MAX,
} from '../../../opportunities/opportunity-tags';
import { TrelloComentarioDto } from './trello-comentario.dto';

// Teto de mensagens espelhadas por chamada. Cartão de solicitação tem
// meia dúzia de comentários; 200 é o limite pra uma requisição gigante
// não virar uma transação longa.
export const TRELLO_COMENTARIOS_MAX = 200;

// "Cadastrar Oportunidade" na tela Trello do app de cotações: cria a
// oportunidade no Funil Padrão a partir de um cartão da lista
// "SOLICITAÇÃO DE PROPOSTAS". Idempotente pelo card_id — apertar duas
// vezes devolve a mesma oportunidade.
export class TrelloVinculoDto {
  @Matches(/^[0-9a-f]{24}$/i, {
    message: 'card_id deve ser um id do Trello (24 caracteres hexadecimais).',
  })
  card_id!: string;

  // Link do cartão, guardado pra dar o caminho de volta do CRM pro
  // Trello. Preso ao domínio do Trello: é um link que vai ser clicado
  // por gente dentro do CRM, não pode virar redirecionamento pra
  // qualquer lugar que o payload mandar.
  @IsOptional()
  @Matches(/^https:\/\/trello\.com\/c\/[A-Za-z0-9]{1,32}(\/[\w%-]{0,120})?$/, {
    message: 'card_url deve ser um link de cartão do Trello.',
  })
  card_url?: string;

  // Empresa da oportunidade. O app manda o id quando o cliente já está
  // no espelho (caso normal, todo cliente tem crm_company_id desde a
  // fase 1); o CNPJ é o caminho de reserva. Pelo menos um dos dois —
  // checado no service, que class-validator não expressa "um ou outro".
  @IsOptional()
  @IsUUID()
  crm_company_id?: string;

  @IsOptional()
  @Matches(/^\d{14}$/, { message: 'cnpj deve ter exatamente 14 dígitos.' })
  cnpj?: string;

  // Nome do QUADRO do Trello ("LAURO BRANDÃO - SC"). Cada representante
  // tem o quadro dele, então é o quadro que diz de quem é a cotação — o
  // CRM casa com o nome do membro e usa como responsável. Sem casamento,
  // cai no dono padrão (nunca chuta representante).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  representante?: string;

  // O que o cliente pediu — vira a lista lateral de itens do card
  // (opportunity_items). Vem dos itens de checklist do cartão, revisados
  // pela pessoa no modal antes de confirmar.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(ITEM_NAME_MAX, { each: true })
  itens?: string[];

  // Chat do cartão já na criação (evita um segundo round-trip só pra
  // trazer a conversa que motivou a solicitação).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TRELLO_COMENTARIOS_MAX)
  @ValidateNested({ each: true })
  @Type(() => TrelloComentarioDto)
  comentarios?: TrelloComentarioDto[];
}
