import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

// Body de POST /raw-leads/bulk-approve e /bulk-discard (SPEC-CRM-GAMA.md
// §4.4: "aprovar/descartar em lote, 'selecionar quentes'").
export class BulkRawLeadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];
}
