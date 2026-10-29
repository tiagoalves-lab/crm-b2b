import { Module } from '@nestjs/common';
import { EgestorModule } from '../integrations/egestor/egestor.module';
import { MembershipModule } from '../memberships/membership.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FiscalAgendadorService } from './fiscal-agendador.service';
import { FiscalNotasSyncService } from './fiscal-notas-sync.service';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';

@Module({
  imports: [TenancyModule, PolicyModule, EgestorModule, MembershipModule],
  controllers: [FiscalController],
  providers: [FiscalService, FiscalNotasSyncService, FiscalAgendadorService],
  exports: [FiscalNotasSyncService],
})
export class FiscalModule {}
