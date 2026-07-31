import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';

export interface BuscaEmpresaLeadResult {
  id: string;
  origem: 'empresa' | 'lead';
  nome: string;
  cnpj: string | null;
}

// Seletor de empresa do formulário "Nova oportunidade" (SPEC-CRM-GAMA.md
// §3.5/§4.2.1) — busca unificada sobre a view v_busca_empresa_lead, que já
// herda RLS das tabelas-base (companies/raw_leads), então nenhum filtro de
// workspace_id extra é necessário aqui.
@Injectable()
export class SearchService {
  async buscaEmpresaLead(
    tx: TenantTx,
    q: string | undefined,
  ): Promise<BuscaEmpresaLeadResult[]> {
    const term = (q ?? '').trim();
    if (term.length < 2) {
      return [];
    }

    const like = `%${term}%`;
    return tx.$queryRaw<BuscaEmpresaLeadResult[]>`
      SELECT "id", "origem", "nome", "cnpj"
      FROM "v_busca_empresa_lead"
      WHERE "nome" ILIKE ${like} OR "cnpj" ILIKE ${like}
      ORDER BY "origem", "nome"
      LIMIT 20
    `;
  }
}
