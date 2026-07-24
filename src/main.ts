import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);

  // whitelist+forbidNonWhitelisted: campo não declarado no DTO é erro (400),
  // não descartado silenciosamente — evita, por exemplo, que um cliente
  // tente setar `status`/`lostReason` na criação de uma Opportunity.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS restritivo — nunca "*" com credenciais habilitadas (ver
  // docs/seguranca.md, seção 5). FRONTEND_ORIGIN tem default de dev em
  // src/config/configuration.ts; em produção é obrigatório configurar.
  const frontendOrigin = configService.get<string>('frontendOrigin');
  if (!frontendOrigin) {
    throw new Error(
      'FRONTEND_ORIGIN não configurada — obrigatória para restringir CORS (ver docs/seguranca.md, seção 5).',
    );
  }
  app.enableCors({ origin: frontendOrigin, credentials: true });

  await app.listen(port);
}
void bootstrap();
