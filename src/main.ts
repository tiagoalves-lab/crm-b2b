import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe, type ValidationError } from '@nestjs/common';
import helmet from 'helmet';
import { json, raw, type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module';
import { httpTiming } from './common/http-timing.middleware';
import { PROPOSTA_HTML_MAX } from './integrations/cotacoes/dto/upsert-proposta.dto';
import { GRAVACAO_MAX_BYTES } from './telefonia/telefonia.constants';

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

  // A proposta congelada do app de cotações chega como HTML dentro do JSON
  // e passa fácil dos 100KB do parser padrão (413 "request entity too
  // large" no "Enviar proposta ao CRM"). O teto maior vale SÓ nesta rota;
  // o resto da API segue nos 100KB. Folga sobre PROPOSTA_HTML_MAX porque o
  // escape do JSON e os acentos (2 bytes) incham o corpo além do texto.
  // O parser padrão do Nest, registrado depois, vê o corpo já lido e pula.
  // Envolto numa função de outro nome: o Nest deixa de registrar o parser
  // global se achar uma camada chamada "jsonParser" na pilha.
  const propostaJson = json({ limit: PROPOSTA_HTML_MAX + 4 * 1024 * 1024 });
  app.use(
    '/integrations/cotacoes/propostas',
    (req: Request, res: Response, next: NextFunction) =>
      propostaJson(req, res, next),
  );

  // Gravação das ligações (2026-10-26): o script da máquina do SDR manda o
  // áudio cru (audio/mpeg ou audio/wav) no corpo. Parser de bytes SÓ nesta
  // rota e só para esses dois tipos; o teto é o do bucket `gravacoes`. A
  // credencial da máquina é conferida no controller (TelefoniaGravacao
  // Controller) antes de qualquer coisa ser guardada.
  const gravacaoRaw = raw({
    type: ['audio/mpeg', 'audio/wav'],
    limit: GRAVACAO_MAX_BYTES,
  });
  app.use(
    '/telefonia/gravacoes',
    (req: Request, res: Response, next: NextFunction) =>
      gravacaoRaw(req, res, next),
  );

  // whitelist+forbidNonWhitelisted: campo não declarado no DTO é erro (400),
  // não descartado silenciosamente — evita, por exemplo, que um cliente
  // tente setar `status`/`lostReason` na criação de uma Opportunity.
  // Recusa de validação vai pro log só com campo e regra (nunca o valor):
  // o webhook do eGestor levava 400 sem deixar rastro de qual campo
  // falhou (2026-10-22).
  const opcoesValidacao = { whitelist: true, forbidNonWhitelisted: true, transform: true };
  const erroPadrao = new ValidationPipe(opcoesValidacao).createExceptionFactory();
  const logValidacao = new Logger('Validacao');
  app.useGlobalPipes(
    new ValidationPipe({
      ...opcoesValidacao,
      exceptionFactory: (erros: ValidationError[]) => {
        logValidacao.warn(
          erros
            .map((e) => `${e.property}: ${Object.keys(e.constraints ?? {}).join(',') || 'campo interno'}`)
            .join('; '),
        );
        return erroPadrao(erros);
      },
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
