import { IsString, Matches, MaxLength } from 'class-validator';

// Máximo de cartões por consulta. A lista "SOLICITAÇÃO DE PROPOSTAS"
// inteira tem uma dúzia de cartões na prática — 100 é folga, não meta.
export const TRELLO_STATUS_MAX_IDS = 100;

// Query de "quais destes cartões já viraram oportunidade" — uma chamada
// só pra tela toda (TrelloPicker.html pinta a coluna Ações com isto).
export class TrelloStatusQueryDto {
  @IsString()
  @MaxLength(TRELLO_STATUS_MAX_IDS * 25)
  @Matches(/^[0-9a-f]{24}(,[0-9a-f]{24})*$/i, {
    message:
      'card_ids deve ser uma lista separada por vírgula de ids do Trello (24 caracteres hexadecimais).',
  })
  card_ids!: string;
}
