import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// Uma mensagem do chat do cartão do Trello, do jeito que o app de
// cotações (gama-webapp/TrelloService.js) a lê da API do Trello. É o
// payload de espelhamento — o CRM não fala com o Trello, quem varre é o
// GAS, que já tem as credenciais.
export class TrelloComentarioDto {
  // Id da "action" do comentário no Trello (24 hex, o mesmo formato de
  // id de cartão). Vira `opportunity_comments.external_ref` e é o que
  // garante que sincronizar duas vezes não duplica mensagem.
  @Matches(/^[0-9a-f]{24}$/i, {
    message: 'ref deve ser um id do Trello (24 caracteres hexadecimais).',
  })
  ref!: string;

  // Nome de quem escreveu NO TRELLO — vai pro texto do comentário, não
  // pro autor: quem escreveu não é usuário do CRM, e inventar um autor
  // faria a mensagem parecer de alguém daqui.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  autor?: string;

  @IsString()
  @MaxLength(4000)
  texto!: string;

  // Data do comentário no Trello — vira o `created_at` da mensagem, pra
  // o chat do card ficar na ordem em que a conversa aconteceu.
  @IsOptional()
  @IsISO8601()
  em?: string;
}
