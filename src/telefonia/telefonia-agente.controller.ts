import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { CallService } from './call.service';
import { EventoChamadaDto } from './dto/evento-chamada.dto';
import { TelefoniaDeviceService } from './telefonia-device.service';

// Rota pública de propósito: quem chama é o script instalado junto do
// MicroSIP na máquina do SDR (scripts/telefonia/), que não tem sessão de
// navegador nem JWT do Supabase. A autenticação real é a credencial da
// máquina no header Authorization, conferida em
// TelefoniaDeviceService#autenticar — é ela que também diz DE QUEM é a
// chamada. Mesma disciplina do webhook da planilha do Meta: declarada em
// ROTAS_PUBLICAS do test/idor.e2e-spec.ts, com teste do controle
// substituto. Throttle por IP, já que não há usuário autenticado aqui.
@Controller('telefonia/eventos')
export class TelefoniaAgenteController {
  constructor(
    private readonly calls: CallService,
    private readonly devices: TelefoniaDeviceService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post()
  async receber(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: EventoChamadaDto,
  ) {
    // Confere a credencial ANTES de gravar qualquer coisa — evento forjado
    // nunca vira linha de chamada.
    const device = await this.devices.autenticar(authorization);

    const chamada = await this.tenantContext.run(
      {
        userId: device.userId,
        workspaceId: device.workspaceId,
        role: 'owner',
      },
      (tx) =>
        this.calls.registrarEvento(tx, device.workspaceId, device.userId, dto),
    );

    return { status: 'ok', chamadaId: chamada?.id ?? null };
  }
}
