import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

// Fila de cotação (gama-webapp/planejamento/integracao-crm.md §19): o app de
// cotações pergunta "o que o funil está pedindo que ainda não foi cotado".
// Quem responde "já cotou?" é o outro lado — aqui só sai o pedido.
export class FilaQueryDto {
  // Teto de solicitações devolvidas. A fila é para ser trabalhada, não
  // paginada: 200 cobre folgado o funil aberto da Gama, e a resposta avisa
  // quando cortou (`truncado`) em vez de mentir por omissão.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limite?: number;

  // A carga histórica de cotações (origem 'historico-cotacoes') fica FORA por
  // padrão: ela não passou pela jornada e encheria a fila com pedido que
  // ninguém vai cotar. O flag existe para conferência pontual.
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  incluir_historico?: boolean;
}
