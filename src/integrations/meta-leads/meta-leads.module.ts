import { Module } from '@nestjs/common';
import { CompanyModule } from '../../companies/company.module';
import { RawLeadModule } from '../../raw-leads/raw-lead.module';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { MetaGraphService } from './meta-graph.service';
import { MetaLeadsWebhookController } from './meta-leads-webhook.controller';
import { MetaLeadsWebhookService } from './meta-leads-webhook.service';

// Ingestão de leads da Central de Leads do Meta Business Suite. Reaproveita
// RawLeadService/ContactService em vez de ter persistência própria — o lead
// do Meta entra na MESMA esteira de staging dos leads de planilha/crawler
// (scoring, quente/morno/frio, "Aprovar para Lead"), sem tabela nova pro
// lead em si. Ver docs/webhook-meta-leads.md.
@Module({
  imports: [TenancyModule, RawLeadModule, CompanyModule],
  controllers: [MetaLeadsWebhookController],
  providers: [MetaGraphService, MetaLeadsWebhookService],
})
export class MetaLeadsModule {}
