import { Module } from '@nestjs/common';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { CotacoesController } from './cotacoes.controller';
import { CotacoesService } from './cotacoes.service';

// Integração com o app de cotações (gama-webapp, Google Apps Script). O CRM
// é a fonte da verdade de clientes; a tabela `clientes` de lá é espelho
// somente-leitura alimentado pela rota GET companies, e o cadastro feito na
// cotação entra aqui pela rota POST clientes (direto em Empresas, selo
// Lead — regra 3.10). Ver docs/integracao-cotacoes.md e o plano mestre em
// gama-webapp/planejamento/integracao-crm.md.
@Module({
  imports: [TenancyModule],
  controllers: [CotacoesController],
  providers: [CotacoesService],
})
export class CotacoesModule {}
