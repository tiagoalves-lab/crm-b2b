import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  GRAVACOES_BUCKET,
  SupabaseStorageService,
} from '../storage/supabase-storage.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { EnviarGravacaoDto } from './dto/enviar-gravacao.dto';
import type { DispositivoAutenticado } from './telefonia-device.service';
import {
  GRAVACAO_MAX_BYTES,
  JANELA_GRAVACAO_MINUTOS,
} from './telefonia.constants';

const TIPO_POR_FORMATO = { mp3: 'audio/mpeg', wav: 'audio/wav' } as const;
type Formato = keyof typeof TIPO_POR_FORMATO;

export interface NomeDaGravacao {
  formato: Formato;
  // Data e hora do nome (horário do PC, Brasília), já em UTC. Nulo quando o
  // nome não segue o padrão do MicroSIP.
  gravadoEm: Date | null;
  // Número do outro lado, só dígitos. Nulo quando não deu pra extrair.
  telefone: string | null;
}

// Gravação das ligações (docs/telefonia-crm.md, decisões 1.6 e 1.8). O
// script da máquina do SDR envia o arquivo que o MicroSIP gravou; aqui ele
// é conferido, casado com a ligação registrada e guardado no bucket
// privado. Nada daqui é lido por tela nenhuma — a gravação existe só no
// servidor, por decisão do usuário.
@Injectable()
export class GravacaoService {
  private readonly logger = new Logger(GravacaoService.name);

  constructor(
    private readonly storage: SupabaseStorageService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async receber(
    device: DispositivoAutenticado,
    dto: EnviarGravacaoDto,
    contentType: string | undefined,
    corpo: unknown,
  ): Promise<{ gravacaoId: string; chamadaId: string | null }> {
    const nome = lerNomeDaGravacao(dto.arquivo);
    const bytes = Buffer.isBuffer(corpo) ? corpo : null;
    if (!bytes || bytes.length === 0) {
      throw new BadRequestException('Arquivo de áudio vazio.');
    }
    if (bytes.length > GRAVACAO_MAX_BYTES) {
      throw new PayloadTooLargeException('Arquivo de áudio grande demais.');
    }
    const tipo = TIPO_POR_FORMATO[nome.formato];
    if ((contentType ?? '').split(';')[0].trim().toLowerCase() !== tipo) {
      throw new BadRequestException(`Tipo do arquivo deve ser ${tipo}.`);
    }
    if (!pareceAudio(bytes, nome.formato)) {
      throw new BadRequestException('O arquivo não é um áudio válido.');
    }

    const gravadoEm =
      (dto.gravadoEm ? new Date(dto.gravadoEm) : null) ??
      nome.gravadoEm ??
      new Date();

    const ctx = {
      userId: device.userId,
      workspaceId: device.workspaceId,
      role: 'owner' as const,
    };

    // Reenvio do mesmo arquivo: devolve o que já existe, sem subir de novo.
    const existente = await this.tenantContext.run(ctx, (tx) =>
      this.buscarExistente(tx, device, dto.arquivo),
    );
    if (existente) {
      return { gravacaoId: existente.id, chamadaId: existente.callId };
    }

    const chamadaId = await this.tenantContext.run(ctx, (tx) =>
      casarComChamada(tx, device, nome.telefone, gravadoEm),
    );

    // Sobe ANTES de gravar a linha e fora da transação: o upload pode levar
    // segundos e a transação tem 5 s de prazo. Linha sem arquivo seria pior
    // que arquivo sem linha (este é removido logo abaixo se a linha falhar).
    const id = randomUUID();
    const storagePath = [
      device.workspaceId,
      gravadoEm.getUTCFullYear(),
      String(gravadoEm.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.${nome.formato}`,
    ].join('/');
    await this.storage.upload(storagePath, bytes, tipo, GRAVACOES_BUCKET);

    try {
      await this.tenantContext.run(ctx, (tx) =>
        tx.callRecording.create({
          data: {
            id,
            workspaceId: device.workspaceId,
            userId: device.userId,
            deviceId: device.deviceId,
            callId: chamadaId,
            arquivoNome: dto.arquivo,
            telefone: nome.telefone,
            gravadoEm,
            tamanhoBytes: bytes.length,
            formato: nome.formato,
            storagePath,
          },
        }),
      );
    } catch (erro) {
      await this.storage
        .remove(storagePath, GRAVACOES_BUCKET)
        .catch((e: unknown) =>
          this.logger.warn(`Áudio órfão no bucket (${storagePath}): ${String(e)}`),
        );
      // Duas execuções do script enviaram o mesmo arquivo ao mesmo tempo:
      // a outra já gravou, e isso é sucesso para quem enviou.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        const outra = await this.tenantContext.run(ctx, (tx) =>
          this.buscarExistente(tx, device, dto.arquivo),
        );
        if (outra) return { gravacaoId: outra.id, chamadaId: outra.callId };
      }
      throw erro;
    }

    return { gravacaoId: id, chamadaId };
  }

  private buscarExistente(
    tx: TenantTx,
    device: DispositivoAutenticado,
    arquivo: string,
  ) {
    return tx.callRecording.findFirst({
      where: {
        workspaceId: device.workspaceId,
        userId: device.userId,
        arquivoNome: arquivo,
      },
      select: { id: true, callId: true },
    });
  }
}

// Padrão do MicroSIP (msip_call_recording_start):
//   AAAAMMDD-HHMMSS-<número>-<outgoing|incoming>-<conta>.mp3
// com espaço, ponto, barra e afins trocados por "_". A data é o horário
// local do PC no momento em que a chamada foi atendida.
const PADRAO_MICROSIP =
  /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+?)-(?:outgoing|incoming)-.*\.(mp3|wav)$/;

export function lerNomeDaGravacao(arquivo: string): NomeDaGravacao {
  const formato = arquivo.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3';
  const m = PADRAO_MICROSIP.exec(arquivo);
  if (!m) return { formato, gravadoEm: null, telefone: null };

  const [, ano, mes, dia, hora, min, seg, numero] = m;
  // Brasil sem horário de verão desde 2019: o PC da SDR está sempre em -03:00.
  const gravadoEm = new Date(`${ano}-${mes}-${dia}T${hora}:${min}:${seg}-03:00`);
  const digitos = numero.replace(/\D/g, '');
  return {
    formato,
    gravadoEm: Number.isNaN(gravadoEm.getTime()) ? null : gravadoEm,
    telefone: digitos.length >= 8 ? digitos : null,
  };
}

// Confere o começo do arquivo: o tipo declarado no envio é só uma etiqueta.
// MP3 começa com a marca ID3 ou com o sincronismo de quadro (11 bits em 1);
// WAV com "RIFF....WAVE".
export function pareceAudio(bytes: Buffer, formato: Formato): boolean {
  if (formato === 'wav') {
    return (
      bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WAVE'
    );
  }
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

// A ligação desta gravação: mesma pessoa, mesmo número (últimos 8
// dígitos — o MicroSIP pode mandar o número com ou sem 55/DDD/prefixo de
// operadora) e atendimento a até JANELA_GRAVACAO_MINUTOS do horário do
// arquivo. Mais de uma candidata: a de horário mais próximo.
export async function casarComChamada(
  tx: TenantTx,
  device: DispositivoAutenticado,
  telefone: string | null,
  gravadoEm: Date,
): Promise<string | null> {
  const folga = JANELA_GRAVACAO_MINUTOS * 60_000;
  const de = new Date(gravadoEm.getTime() - folga);
  const ate = new Date(gravadoEm.getTime() + folga);

  const candidatas = await tx.call.findMany({
    where: {
      workspaceId: device.workspaceId,
      userId: device.userId,
      OR: [
        { atendidaEm: { gte: de, lte: ate } },
        { atendidaEm: null, iniciadaEm: { gte: de, lte: ate } },
      ],
    },
    select: { id: true, telefone: true, atendidaEm: true, iniciadaEm: true },
  });

  const final = telefone ? telefone.slice(-8) : null;
  const melhor = candidatas
    .filter((c) => !final || c.telefone.replace(/\D/g, '').slice(-8) === final)
    .map((c) => ({
      id: c.id,
      distancia: Math.abs(
        (c.atendidaEm ?? c.iniciadaEm).getTime() - gravadoEm.getTime(),
      ),
    }))
    .sort((a, b) => a.distancia - b.distancia)[0];

  return melhor?.id ?? null;
}
