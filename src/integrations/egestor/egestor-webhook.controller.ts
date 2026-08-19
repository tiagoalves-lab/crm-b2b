import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { EgestorWebhookPayloadDto } from './dto/egestor-webhook-payload.dto';
import { EgestorWebhookService } from './egestor-webhook.service';
import type { Estabelecimento } from './egestor.types';

const ESTABELECIMENTOS = new Set<Estabelecimento>(['matriz', 'filial']);

// Rota pública de propósito — quem chama é o eGestor, não um usuário
// logado no Supabase (sem JWT nenhum na requisição). A autenticação real
// é o `securityToken` do corpo (ver EgestorWebhookService#assertValidToken),
// não o SupabaseAuthGuard/TenantMembershipGuard — por isso @Public() nos
// dois níveis (guard de auth e guard de tenant, ver public.decorator.ts).
// Separado de EgestorSyncController de propósito: aquele exige
// owner/admin, este não exige autenticação nenhuma — mantém a superfície
// pública fácil de auditar num controller só.
@Controller('integrations/egestor/webhook')
export class EgestorWebhookController {
  constructor(private readonly webhook: EgestorWebhookService) {}

  // Throttle por IP (não há usuário autenticado aqui, ver
  // UserThrottlerGuard) — generoso o bastante pra um pico de edições em
  // lote numa das contas, mas limita abuso de quem descobrir a URL.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post(':estabelecimento')
  async receber(
    @Param('estabelecimento') estabelecimentoParam: string,
    @Body() payload: EgestorWebhookPayloadDto,
  ) {
    if (!ESTABELECIMENTOS.has(estabelecimentoParam as Estabelecimento)) {
      throw new BadRequestException(
        'estabelecimento deve ser "matriz" ou "filial".',
      );
    }
    const estabelecimento = estabelecimentoParam as Estabelecimento;

    // Confere o securityToken ANTES de gravar qualquer coisa — payload
    // forjado nunca chega a virar linha na tabela.
    this.webhook.assertValidToken(estabelecimento, payload.securityToken);

    // Processamento operacional (2026-08-12) — pode levar mais que os 3s
    // de timeout do eGestor num caso raro (rede lenta pro GET de
    // confirmação). Se `handleEvent` lançar, o erro propaga e vira 500 —
    // de propósito: é o que faz o eGestor tentar de novo (até 5x), dando
    // ao evento (já registrado com `processedAt` nulo) uma nova chance de
    // ser processado, sem precisar de fila/cron nenhum.
    const { processResult } = await this.webhook.handleEvent(
      estabelecimento,
      payload,
    );

    return { status: 'ok', processResult };
  }
}
