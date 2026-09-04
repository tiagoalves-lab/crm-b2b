import { Module } from '@nestjs/common';
import { ActivityModule } from '../../activities/activity.module';
import { CompanyModule } from '../../companies/company.module';
import { RawLeadModule } from '../../raw-leads/raw-lead.module';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { MetaGraphService } from './meta-graph.service';
import { MetaLeadsPlanilhaController } from './meta-leads-planilha.controller';
import { MetaLeadsPlanilhaService } from './meta-leads-planilha.service';
import { MetaLeadsWebhookController } from './meta-leads-webhook.controller';
import { MetaLeadsWebhookService } from './meta-leads-webhook.service';

// Ingestão de leads da Central de Leads do Meta Business Suite, por dois
// canais que desembocam na mesma esteira: o webhook direto da Meta
// (MetaLeadsWebhookController, parado enquanto o App não sai do modo
// desenvolvimento) e a planilha do gestor de tráfego
// (MetaLeadsPlanilhaController, canal em uso desde 2026-09-04). Reaproveita
// RawLeadService/ContactService/ActivityService em vez de ter persistência
// própria — o lead do Meta entra na MESMA esteira de staging dos leads de
// planilha/crawler (scoring, quente/morno/frio, "Aprovar para Lead"), sem
// tabela nova pro lead em si. Ver docs/webhook-meta-leads.md.
@Module({
  imports: [TenancyModule, RawLeadModule, CompanyModule, ActivityModule],
  controllers: [MetaLeadsWebhookController, MetaLeadsPlanilhaController],
  providers: [
    MetaGraphService,
    MetaLeadsWebhookService,
    MetaLeadsPlanilhaService,
  ],
})
export class MetaLeadsModule {}
