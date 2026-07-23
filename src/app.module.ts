import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';

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
  ],
  controllers: [AppController],
})
export class AppModule {}
