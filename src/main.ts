import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);

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
