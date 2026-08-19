import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { MetaLeadsWebhookPayloadDto } from './dto/meta-leads-webhook-payload.dto';
import { MetaLeadsWebhookService } from './meta-leads-webhook.service';

// Rota pública de propósito — quem chama é a Meta, não um usuário logado no
// Supabase (sem JWT nenhum na requisição). A autenticação real é a
// assinatura HMAC do corpo (X-Hub-Signature-256, ver
// MetaLeadsWebhookService#assertAssinaturaValida), não o
// SupabaseAuthGuard/TenantMembershipGuard — por isso @Public() nos dois
// níveis (ver public.decorator.ts). Mesma disciplina do
// EgestorWebhookController: toda a superfície pública deste módulo mora
// neste controller só, fácil de auditar.
@Controller('integrations/meta-leads/webhook')
export class MetaLeadsWebhookController {
  constructor(private readonly webhook: MetaLeadsWebhookService) {}

  // Handshake de verificação: a Meta chama uma vez, no cadastro da
  // assinatura, e só aceita a URL se receber o `hub.challenge` de volta cru
  // (text/plain, sem JSON em volta).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public()
  @Header('Content-Type', 'text/plain')
  @Get()
  verificar(@Query() query: Record<string, string>): string {
    return this.webhook.verificarHandshake(
      query['hub.mode'],
      query['hub.verify_token'],
      query['hub.challenge'],
    );
  }

  // Throttle por IP (não há usuário autenticado aqui, ver
  // UserThrottlerGuard) — folgado o bastante pra um pico de campanha
  // rodando bem, restritivo o bastante pra limitar abuso de quem descobrir
  // a URL (sem o App Secret, nada passa da validação de assinatura de
  // qualquer forma).
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post()
  async receber(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: MetaLeadsWebhookPayloadDto,
  ) {
    // Confere a assinatura ANTES de gravar qualquer coisa — payload forjado
    // nunca chega a virar linha na tabela nem a gastar uma chamada da Graph
    // API.
    this.webhook.assertAssinaturaValida(
      req.rawBody,
      req.headers['x-hub-signature-256'] as string | undefined,
    );

    // Processamento inline (sem fila), igual ao webhook eGestor: se algo
    // falhar, o erro propaga e vira 500 — de propósito, é o que faz a Meta
    // reenviar o evento, dando nova chance ao lead sem precisar de
    // fila/cron. O evento já registrado com `processedAt` nulo é
    // reprocessado no reenvio.
    const processados = await this.webhook.handleEvent(payload);

    return { status: 'ok', processados };
  }
}
