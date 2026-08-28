import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ActivityModule } from './activities/activity.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './companies/company.module';
import { CountsModule } from './counts/counts.module';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { CotacoesModule } from './integrations/cotacoes/cotacoes.module';
import { EgestorModule } from './integrations/egestor/egestor.module';
import { MetaLeadsModule } from './integrations/meta-leads/meta-leads.module';
import { MeController } from './me/me.controller';
import { MembershipModule } from './memberships/membership.module';
import { OpportunityModule } from './opportunities/opportunity.module';
import { PipelineModule } from './pipelines/pipeline.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { RawLeadModule } from './raw-leads/raw-lead.module';
import { SalesHistoryModule } from './sales-history/sales-history.module';
import { SearchModule } from './search/search.module';
import { TaskModule } from './tasks/task.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { UserThrottlerGuard } from './common/throttler/user-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      // Local dev: valores vêm do arquivo .env (não versionado, ver .env.example).
      // Staging/produção: variáveis de ambiente reais injetadas pela plataforma,
      // .env não existe e o dotenv simplesmente não encontra nada para carregar.
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
      validate,
    }),
    PrismaModule,
    // Rate limiting (docs/seguranca.md, decisão 5.4). O limite default é
    // generoso de propósito: uma única navegação no CRM dispara várias
    // chamadas ao backend, porque cada tela é Server Component e busca
    // seus dados em paralelo. Apertar isso não aumenta segurança de forma
    // relevante e quebraria uso legítimo. O que protege de verdade são os
    // limites específicos nas rotas caras (ver @Throttle nos controllers
    // de importação).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    // Ordem importa: guards globais rodam na ordem em que os módulos que os
    // registram (via APP_GUARD) são resolvidos — AuthModule primeiro
    // (autentica o JWT), TenancyModule depois (resolve/cria o Membership
    // já sabendo quem é o usuário).
    AuthModule,
    TenancyModule,
    PolicyModule,
    ActivityModule,
    CompanyModule,
    PipelineModule,
    OpportunityModule,
    TaskModule,
    MembershipModule,
    RawLeadModule,
    SalesHistoryModule,
    SearchModule,
    EgestorModule,
    MetaLeadsModule,
    CotacoesModule,
    CountsModule,
  ],
  controllers: [AppController, MeController],
  providers: [
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    // Registrado aqui, nos providers do próprio AppModule, e não num
    // módulo importado — providers do módulo host são resolvidos depois
    // dos imports, então este guard roda DEPOIS do SupabaseAuthGuard e
    // enxerga `request.user`. É disso que depende o rate limit ser por
    // usuário em vez de por IP (ver UserThrottlerGuard pro motivo de
    // por-IP quebrar o CRM inteiro).
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule {}
