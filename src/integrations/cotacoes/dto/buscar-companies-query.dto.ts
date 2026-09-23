import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Query da busca ao vivo de clientes (gama-webapp, crm_clientes_buscar_srv).
// Nada de `desde`/`pagina` aqui: quem chama está com o modal de escolher
// cliente aberto e quer as primeiras linhas que casam com o que digitou —
// não uma varredura da base.
export class BuscarCompaniesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  tamanho?: number;
}
