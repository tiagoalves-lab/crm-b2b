import { Injectable } from '@nestjs/common';
import { montarAtualizacaoCartaoCnpj } from '../../companies/cartao-cnpj';
import { CompanyService } from '../../companies/company.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import type {
  TenantContext,
  TenantTx,
} from '../../tenancy/tenant-context.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';

// Empresa que entra sozinha pelo eGestor nasce com o cadastro do ERP
// (razão social, endereço, e-mail/telefone digitados lá) — mas a aba
// "Dados cadastrais" da ficha mostra o **Cartão CNPJ da Receita Federal**
// (situação cadastral, CNAE, porte, natureza jurídica), que o eGestor não
// tem como fornecer. Até 2026-08-19 nenhum caminho automático consultava a
// Receita: a aba ficava vazia ("Nenhum dado cadastral ainda") até alguém
// abrir a empresa e clicar em "Buscar dados" na mão — o que só não doía
// porque as 288 empresas importadas em lote tinham sido sanitizadas pelo
// script (scripts/sanitizar-cadastros-cnpj.ts, 2026-08-13). Empresa nova
// nascia sem. Este serviço fecha esse buraco, com a MESMA regra de merge
// do script e do botão da ficha (../../companies/cartao-cnpj.ts).
//
// Roda sempre FORA da transação do webhook: é chamada HTTP pra internet
// (BrasilAPI, alguns segundos no pior caso) e transação aberta esperando
// rede é o jeito clássico de estourar o pool do Postgres. Por isso o
// serviço abre suas próprias transações curtas (uma pra ler, outra pra
// gravar) em vez de receber uma `tx` pronta.
//
// Falha aqui NUNCA derruba o processamento do webhook: a empresa já entrou
// com o dado do eGestor, o Cartão CNPJ é enriquecimento. Erro vira status
// no retorno (e linha no histórico da tela), não exceção — o eGestor não
// deve receber 500 e ficar reenviando o evento por causa da Receita fora
// do ar.
@Injectable()
export class EgestorCartaoCnpjService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly companies: CompanyService,
  ) {}

  async preencherSeFaltando(
    ctx: TenantContext,
    membership: MembershipContext,
    companyId: string,
  ): Promise<ResultadoCartaoCnpj> {
    const company = await this.tenantContext.run(ctx, (tx: TenantTx) =>
      tx.company.findFirst({ where: { id: companyId, deletedAt: null } }),
    );
    if (!company) return { status: 'sem_company' };

    // Só completa o que falta — empresa que já tem a ficha (cadastro
    // manual com "Buscar dados", lote sanitizado) não é reconsultada a
    // cada webhook. Manter o dado da Receita em dia é papel do script de
    // sanitização, não de cada evento de contato do ERP.
    const customFields =
      (company.customFields as Record<string, unknown>) ?? {};
    if (customFields.cnpj_lookup) return { status: 'ja_tinha' };

    const digits = (company.cpfCnpj ?? '').replace(/\D/g, '');
    // BrasilAPI cnpj/v1 só serve CNPJ — pessoa física (11 dígitos) ou
    // documento incompleto não tem Cartão CNPJ pra buscar.
    if (digits.length !== 14) return { status: 'sem_cnpj' };

    try {
      const lookup = await this.companies.lookupCnpj(digits);
      const atualizacao = montarAtualizacaoCartaoCnpj(
        company,
        lookup,
        new Date(),
      );
      await this.tenantContext.run(ctx, (tx: TenantTx) =>
        this.companies.update(tx, membership, company.id, atualizacao.dto),
      );
      return {
        status: 'preenchido',
        camposAtualizados: atualizacao.alterados.map((a) => a.campo),
        emailsFonesConflito: atualizacao.emailsFonesConflito,
      };
    } catch (err) {
      return {
        status: 'erro',
        motivo: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export type ResultadoCartaoCnpj =
  | {
      status: 'preenchido';
      camposAtualizados: string[];
      // Receita e CRM têm e-mail/telefone que o outro não conhece — o
      // dado do CRM foi preservado (regra de merge), fica registrado no
      // histórico pra revisão manual.
      emailsFonesConflito: boolean;
    }
  | { status: 'ja_tinha' }
  | { status: 'sem_company' }
  | { status: 'sem_cnpj' }
  | { status: 'erro'; motivo: string };
