import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { httpTiming } from './common/http-timing.middleware';

async function bootstrap() {
  // `rawBody: true` mantém o corpo original (Buffer) em `request.rawBody`
  // além do JSON já parseado — exigido pela validação de assinatura do
  // webhook da Central de Leads do Meta (X-Hub-Signature-256 é o HMAC dos
  // BYTES exatos que a Meta enviou; recalcular a partir de
  // JSON.stringify(body) daria outro resultado a qualquer diferença de
  // espaçamento/ordem de chaves). Ver MetaLeadsWebhookService.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);

  // Cabeçalhos de segurança HTTP (docs/seguranca.md, decisão 5.3).
  // Este backend só devolve JSON, então a CSP daqui é quase irrelevante
  // na prática — quem precisa de CSP de verdade é o Next.js, e ela está
  // em web/middleware.ts. O que importa aqui é HSTS, nosniff e negar
  // enquadramento.
  app.use(httpTiming());
  app.use(
    helmet({
      // A API é consumida de outra origem (servidor da Vercel). O default
      // do helmet é `same-origin`, que passaria a bloquear leitura
      // cross-origin caso alguma tela venha a chamar a API direto do
      // navegador no futuro. Hoje nada quebraria, mas o default silencioso
      // seria uma armadilha difícil de diagnosticar depois.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

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
  // Aceita uma ou mais origens separadas por vírgula (ver configuration.ts).
  const frontendOrigin = configService.get<string[]>('frontendOrigin');
  if (!frontendOrigin || frontendOrigin.length === 0) {
    throw new Error(
      'FRONTEND_ORIGIN não configurada — obrigatória para restringir CORS (ver docs/seguranca.md, seção 5).',
    );
  }
  app.enableCors({ origin: frontendOrigin, credentials: true });

  await app.listen(port);
}
void bootstrap();
