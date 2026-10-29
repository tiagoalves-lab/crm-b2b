import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { EnviarGravacaoDto } from './dto/enviar-gravacao.dto';
import { GravacaoService } from './gravacao.service';
import { TelefoniaDeviceService } from './telefonia-device.service';

// Recebe o áudio que o MicroSIP gravou (docs/telefonia-crm.md, decisões 1.6
// e 1.8). Pública pelo mesmo motivo de POST /telefonia/eventos: quem chama
// é o script da máquina do SDR, sem sessão de navegador. Controle
// substituto: a credencial da máquina no Authorization, conferida ANTES de
// qualquer coisa ser guardada. Declarada em ROTAS_PUBLICAS do
// test/idor.e2e-spec.ts.
//
// O corpo é o arquivo cru (audio/mpeg ou audio/wav), lido pelo parser
// registrado só para esta rota em src/main.ts. Não existe rota de leitura:
// nenhuma tela ouve nem lista gravações.
@Controller('telefonia/gravacoes')
export class TelefoniaGravacaoController {
  constructor(
    private readonly gravacoes: GravacaoService,
    private readonly devices: TelefoniaDeviceService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post()
  async receber(
    @Headers('authorization') authorization: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Query() dto: EnviarGravacaoDto,
    @Req() req: Request,
  ) {
    const device = await this.devices.autenticar(authorization);
    const { gravacaoId, chamadaId } = await this.gravacoes.receber(
      device,
      dto,
      contentType,
      req.body,
    );
    return { status: 'ok', gravacaoId, chamadaId };
  }
}
