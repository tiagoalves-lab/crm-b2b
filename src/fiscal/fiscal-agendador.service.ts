import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../tenancy/tenant-context.service';
import { FiscalNotasSyncService } from './fiscal-notas-sync.service';

// Conferência diária das notas emitidas (docs/console-fiscal.md, decisão
// 5.3). A NFS-e não tem webhook no eGestor — é por aqui que ela se mantém
// em dia. De carona, é a rede de segurança da NF-e: evento de webhook que
// se perdeu (backend fora do ar, publicação no meio) é recuperado na
// manhã seguinte, porque a carga é incremental.
//
// Olha a partir do 1º dia do mês anterior: cobre cancelamento e nota
// lançada com atraso sem varrer a base inteira todo dia. Carga mais antiga
// é pelo botão da tela.
//
// As NF-e recebidas têm, além disso, uma conferência de hora em hora em
// horário comercial (decisão 5.5): o eGestor também não avisa delas, e a
// nota que ganha o arquivo depois da ciência não pode esperar o dia
// seguinte.

const WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';
const TIMEZONE = 'America/Sao_Paulo';

@Injectable()
export class FiscalAgendadorService {
  private readonly logger = new Logger(FiscalAgendadorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: FiscalNotasSyncService,
  ) {}

  @Cron('0 6 * * *', { name: 'fiscal-conferencia-diaria', timeZone: TIMEZONE, unrefTimeout: true })
  async conferenciaDiaria(): Promise<void> {
    await this.rodar('Conferência diária de notas', (ctx, desde) => this.sync.executar(ctx, { desde }));
  }

  @Cron('0 7-19 * * 1-5', { name: 'fiscal-recebidas-hora-em-hora', timeZone: TIMEZONE, unrefTimeout: true })
  async conferenciaRecebidas(): Promise<void> {
    await this.rodar('Conferência das NF-e recebidas', (ctx, desde) =>
      this.sync.conferirRecebidas(ctx, { desde }),
    );
  }

  private async rodar(
    nome: string,
    conferir: (ctx: TenantContext, desde: string) => Promise<unknown>,
  ): Promise<void> {
    if (this.sync.status().emAndamento) {
      this.logger.log(`${nome} pulada: já existe uma carga de notas rodando.`);
      return;
    }
    try {
      const workspace = await this.prisma.workspace.findUniqueOrThrow({
        where: { slug: WORKSPACE_SLUG },
        select: { id: true },
      });
      await conferir(
        { userId: SYSTEM_ACTOR_USER_ID, workspaceId: workspace.id, role: 'owner' },
        primeiroDiaDoMesAnterior(new Date()),
      );
    } catch (err) {
      // Nunca derruba o processo: a próxima rodada tenta de novo e o botão
      // da tela continua disponível.
      this.logger.error(`${nome} falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function primeiroDiaDoMesAnterior(agora: Date): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(agora);
  const [ano, mes] = hoje.split('-').map(Number);
  const anterior = new Date(Date.UTC(ano, mes - 2, 1));
  return anterior.toISOString().slice(0, 10);
}
