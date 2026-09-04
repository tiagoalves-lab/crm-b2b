import { Module } from '@nestjs/common';
import { MembershipModule } from '../../memberships/membership.module';
import { OpportunityModule } from '../../opportunities/opportunity.module';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { CotacoesController } from './cotacoes.controller';
import { CotacoesService } from './cotacoes.service';

// Integração com o app de cotações (gama-webapp, Google Apps Script). O CRM
// é a fonte da verdade de clientes; a tabela `clientes` de lá é espelho
// somente-leitura alimentado pela rota GET companies, e o cadastro feito na
// cotação entra aqui pela rota POST clientes (direto em Empresas, selo
// Lead — regra 3.10). Ver docs/integracao-cotacoes.md e o plano mestre em
// gama-webapp/planejamento/integracao-crm.md.
//
// Desde 2026-09-04 a tela do Trello do app de cotações também cadastra
// oportunidade a partir de um cartão e espelha o chat dele no card —
// daí o OpportunityModule (a oportunidade é criada pelo serviço de
// verdade, não por um insert paralelo).
// O MembershipModule entra pelo SupabaseUserService: o representante da
// solicitação é resolvido pelo NOME do quadro do Trello, e nome de membro
// vive em auth.users, não em tabela nossa.
@Module({
  imports: [TenancyModule, OpportunityModule, MembershipModule],
  controllers: [CotacoesController],
  providers: [CotacoesService],
})
export class CotacoesModule {}
