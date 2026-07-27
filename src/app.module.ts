import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ActivityModule } from './activities/activity.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './companies/company.module';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { ContactModule } from './contacts/contact.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { MeController } from './me/me.controller';
import { OpportunityModule } from './opportunities/opportunity.module';
import { PipelineModule } from './pipelines/pipeline.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { TaskModule } from './tasks/task.module';
import { TenancyModule } from './tenancy/tenancy.module';

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
    // Ordem importa: guards globais rodam na ordem em que os módulos que os
    // registram (via APP_GUARD) são resolvidos — AuthModule primeiro
    // (autentica o JWT), TenancyModule depois (resolve/cria o Membership
    // já sabendo quem é o usuário).
    AuthModule,
    TenancyModule,
    PolicyModule,
    ActivityModule,
    CompanyModule,
    ContactModule,
    PipelineModule,
    OpportunityModule,
    TaskModule,
  ],
  controllers: [AppController, MeController],
  providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class AppModule {}
