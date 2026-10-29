import { Injectable, Logger } from '@nestjs/common';
import type {
  TenantContext,
  TenantTx,
} from '../tenancy/tenant-context.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { montarAtualizacaoCartaoCnpj } from './cartao-cnpj';
import { CompanyService } from './company.service';

export type StatusCartaoCnpj =
  'preenchido' | 'ja_tinha' | 'sem_company' | 'sem_cnpj' | 'erro';

// Cartão CNPJ da ficha de Empresas a partir da Prospecção (2026-10-26): o
// lead guarda CNAE/porte/situação nas colunas dele, e a consulta à Receita
// feita na ficha do lead (ou no cadastro de lead novo) não chegava na aba
// "Dados cadastrais" da empresa — a mesma empresa aparecia completa numa
// tela e vazia na outra. O caminho contrário (empresa → lead) é o espelho
// de CompanyService#update.
//
// Mesma consulta e mesma regra de merge do botão "Buscar dados" da ficha
// (./cartao-cnpj.ts). Rede FORA de transação, como no eGestor e nas
// cotações: a BrasilAPI pode levar segundos. Grava com a permissão de quem
// pediu — sem direito de editar a empresa, fica como estava. Falha nunca
// derruba quem chamou: o lead já foi salvo, o cartão é enriquecimento.
@Injectable()
export class CartaoCnpjService {
  private readonly logger = new Logger(CartaoCnpjService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly companies: CompanyService,
  ) {}

  // `forcar`: reconsulta mesmo com cartão já salvo — é o caso do botão
  // "Buscar dados na Receita", em que o usuário pediu a Receita agora.
  async preencher(
    ctx: TenantContext,
    membership: MembershipContext,
    companyId: string,
    { forcar }: { forcar: boolean },
  ): Promise<StatusCartaoCnpj> {
    try {
      const company = await this.tenantContext.run(ctx, (tx: TenantTx) =>
        tx.company.findFirst({ where: { id: companyId, deletedAt: null } }),
      );
      if (!company) return 'sem_company';
      const customFields =
        (company.customFields as Record<string, unknown> | null) ?? {};
      if (!forcar && customFields.cnpj_lookup) return 'ja_tinha';
      const digits = (company.cpfCnpj ?? '').replace(/\D/g, '');
      if (digits.length !== 14) return 'sem_cnpj';

      const lookup = await this.companies.lookupCnpj(digits);
      const atualizacao = montarAtualizacaoCartaoCnpj(
        company,
        lookup,
        new Date(),
      );
      // semTimeline: preenchimento automático, não é ação humana na ficha
      // da empresa (ver SemTimeline em company.service.ts).
      await this.tenantContext.run(ctx, (tx: TenantTx) =>
        this.companies.update(tx, membership, company.id, atualizacao.dto, {
          semTimeline: true,
        }),
      );
      return 'preenchido';
    } catch (err) {
      this.logger.warn(
        `Cartão CNPJ da empresa ${companyId} não preenchido: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'erro';
    }
  }
}
