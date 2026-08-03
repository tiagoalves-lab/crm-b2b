import { IsOptional, IsUUID } from 'class-validator';

export class ListSalesHistoryQueryDto {
  // Ficha da empresa (SPEC-CRM-GAMA.md §4.1) — filtra o histórico de vendas
  // de uma única empresa, mesmo padrão de ListOpportunitiesQueryDto.
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
