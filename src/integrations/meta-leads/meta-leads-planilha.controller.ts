import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { MetaLeadsPlanilhaPayloadDto } from './dto/meta-leads-planilha-payload.dto';
import { MetaLeadsPlanilhaService } from './meta-leads-planilha.service';

// Rota pública de propósito — quem chama é o script instalado na planilha
// do gestor de tráfego (scripts/planilha-meta-leads.gs), não um usuário
// logado no Supabase. A autenticação real é o token estático
// META_LEADS_PLANILHA_TOKEN no header Authorization (Bearer), conferido em
// MetaLeadsPlanilhaService#assertTokenValido — mesma disciplina do
// CotacoesController: declarada em ROTAS_PUBLICAS do test/idor.e2e-spec.ts
// com testes do controle substituto. Throttle por IP (não há usuário
// autenticado aqui).
@Controller('integrations/meta-leads/planilha')
export class MetaLeadsPlanilhaController {
  constructor(private readonly planilha: MetaLeadsPlanilhaService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post()
  async receber(
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: MetaLeadsPlanilhaPayloadDto,
  ) {
    // Confere o token ANTES de gravar qualquer coisa — payload forjado
    // nunca chega a virar linha na tabela de eventos.
    this.planilha.assertTokenValido(authorization);

    // Processamento inline, igual ao webhook: se algo falhar, o erro
    // propaga e vira 500 — o script não marca a linha como enviada e tenta
    // de novo na próxima rodada (a cada 5 minutos), sem fila/cron.
    const processados = await this.planilha.receber(payload);
    return { status: 'ok', processados };
  }
}
