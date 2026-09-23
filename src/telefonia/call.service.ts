import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Call, CallResultado, Prisma } from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import {
  normalizarTelefone,
  variantesDeBusca,
} from '../common/normalize-phone';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { AtualizarChamadaDto } from './dto/atualizar-chamada.dto';
import type { EventoChamadaDto } from './dto/evento-chamada.dto';
import type { IniciarChamadaDto } from './dto/iniciar-chamada.dto';
import type { ListCallsQueryDto } from './dto/list-calls-query.dto';
import {
  JANELA_ABANDONO_MINUTOS,
  JANELA_CASAMENTO_MINUTOS,
} from './telefonia.constants';

const MOTIVO_TEXTO: Record<string, string> = {
  vazio: 'Este contato não tem telefone cadastrado.',
  curto: 'O telefone cadastrado está incompleto.',
  'ddd-invalido': 'O telefone cadastrado está sem DDD válido.',
  'internacional-nao-suportado':
    'Número internacional — a linha da Gama disca só para o Brasil.',
};

// Telefonia (docs/telefonia-crm.md). O CRM não faz a ligação: ele registra
// a intenção, manda o MicroSIP discar (link próprio, do lado do navegador) e
// recebe de volta os eventos da máquina do SDR. Este service é o ponto
// único onde uma chamada vira registro — inclusive a Activity que aparece
// na Timeline da empresa.
@Injectable()
export class CallService {
  constructor(
    private readonly policy: PolicyService,
    private readonly activities: ActivityService,
  ) {}

  async iniciar(
    tx: TenantTx,
    membership: MembershipContext,
    dto: IniciarChamadaDto,
  ): Promise<Call & { sipUri: string; discarUri: string }> {
    if (!this.policy.canModule(membership, 'telefonia', 'criar')) {
      throw new ForbiddenException('Sem permissão para ligar pelo CRM.');
    }

    const { e164, motivo } = normalizarTelefone(dto.telefone);
    if (!e164) {
      throw new BadRequestException(
        MOTIVO_TEXTO[motivo ?? 'curto'] ?? 'Telefone inválido para discagem.',
      );
    }

    // Visibilidade antes de qualquer coisa: 404 (não 403) pra empresa que
    // este usuário não enxerga — docs/seguranca.md, decisão 4.2.
    if (dto.companyId) {
      const visivel = await this.policy.canReadCompany(
        tx,
        membership,
        dto.companyId,
      );
      if (!visivel) throw new NotFoundException('Empresa não encontrada.');
    }

    if (dto.contactId) {
      const contato = await tx.contact.findFirst({
        where: {
          id: dto.contactId,
          workspaceId: membership.workspaceId,
          ...(dto.companyId ? { companyId: dto.companyId } : {}),
        },
        select: { id: true },
      });
      if (!contato) throw new NotFoundException('Contato não encontrado.');
    }

    const chamada = await tx.call.create({
      data: {
        workspaceId: membership.workspaceId,
        userId: membership.userId,
        companyId: dto.companyId ?? null,
        contactId: dto.contactId ?? null,
        rawLeadId: dto.rawLeadId ?? null,
        taskId: dto.taskId ?? null,
        telefone: e164,
        telefoneExibicao: dto.telefone,
      },
    });

    // Dois endereços. `gamafone:` é o nosso, registrado pelo instalador da
    // máquina (scripts/telefonia/instalar.ps1), e é o que a tela usa; o
    // `sip:` fica como reserva. Motivo: em Windows com Office instalado o
    // `sip:` pertence ao Skype for Business — clicar em Ligar abria a tela
    // de login do Skype em vez de discar (achado com o usuário,
    // 2026-09-23). Disputar essa associação com o Office é briga perdida:
    // ele a retoma em atualização e em reparo do pacote.
    return {
      ...chamada,
      sipUri: `sip:${e164}`,
      discarUri: `gamafone:${e164}`,
    };
  }

  // Anotação e/ou encerramento manual. O encerramento manual existe porque
  // a Etapa 1 pode rodar numa máquina que ainda não tem o script instalado
  // — sem ele, a ligação ficaria pendurada sem virar registro.
  async atualizar(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: AtualizarChamadaDto,
  ): Promise<Call> {
    const chamada = await tx.call.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!chamada || !(await this.podeVer(tx, membership, chamada))) {
      throw new NotFoundException('Chamada não encontrada.');
    }
    // Anotar é do dono da chamada. Gerente enxerga a do subordinado, mas
    // não escreve no lugar dele — o registro é da conversa de quem falou.
    if (chamada.userId !== membership.userId) {
      throw new ForbiddenException(
        'Só quem fez a ligação pode anotar nela.',
      );
    }

    const agora = new Date();
    const encerrandoAgora = !!dto.resultado && !chamada.encerradaEm;

    const atualizada = await tx.call.update({
      where: { id: chamada.id },
      data: {
        ...(dto.observacao !== undefined
          ? { observacao: dto.observacao.trim() || null }
          : {}),
        ...(encerrandoAgora
          ? {
              resultado: dto.resultado as CallResultado,
              encerradaEm: agora,
              atendidaEm:
                dto.resultado === 'atendida'
                  ? (chamada.atendidaEm ?? chamada.iniciadaEm)
                  : chamada.atendidaEm,
              duracaoSegundos:
                dto.resultado === 'atendida'
                  ? segundosEntre(
                      chamada.atendidaEm ?? chamada.iniciadaEm,
                      agora,
                    )
                  : 0,
            }
          : {}),
      },
    });

    return this.sincronizarTimeline(tx, atualizada);
  }

  // Chamado pelo script da máquina do SDR (ver TelefoniaAgenteController).
  // Roda no contexto do DONO do token, não de quem está navegando.
  async registrarEvento(
    tx: TenantTx,
    workspaceId: string,
    userId: string,
    dto: EventoChamadaDto,
  ): Promise<Call | null> {
    const { e164 } = normalizarTelefone(dto.telefone);
    if (!e164) {
      // Ramal interno, número mascarado, chamada sem identificação: nada a
      // registrar, mas não é erro do script — devolve vazio e pronto.
      return null;
    }
    const em = dto.em ? new Date(dto.em) : new Date();
    const momento = Number.isNaN(em.getTime()) ? new Date() : em;

    const aberta = await this.chamadaAberta(tx, workspaceId, userId, e164);

    if (dto.evento === 'recebida') {
      // Chamada de entrada nunca tem clique no CRM antes — nasce aqui.
      return tx.call.create({
        data: {
          workspaceId,
          userId,
          telefone: e164,
          telefoneExibicao: dto.telefone,
          direcao: 'entrada',
          iniciadaEm: momento,
          ...(await this.vinculoPorTelefone(tx, workspaceId, e164)),
        },
      });
    }

    if (dto.evento === 'discando') {
      if (aberta) return aberta;
      return tx.call.create({
        data: {
          workspaceId,
          userId,
          telefone: e164,
          telefoneExibicao: dto.telefone,
          iniciadaEm: momento,
          ...(await this.vinculoPorTelefone(tx, workspaceId, e164)),
        },
      });
    }

    // Discou direto no MicroSIP, sem passar pelo botão do CRM: a chamada
    // nasce aqui mesmo, já com o vínculo descoberto pelo telefone.
    const chamada =
      aberta ??
      (await tx.call.create({
        data: {
          workspaceId,
          userId,
          telefone: e164,
          telefoneExibicao: dto.telefone,
          iniciadaEm: momento,
          ...(await this.vinculoPorTelefone(tx, workspaceId, e164)),
        },
      }));

    if (dto.evento === 'atendida') {
      if (chamada.atendidaEm) return chamada;
      return tx.call.update({
        where: { id: chamada.id },
        data: { atendidaEm: momento },
      });
    }

    // 'encerrada': é aqui que a ligação vira registro na Timeline.
    const atendida = chamada.atendidaEm;
    const encerrada = await tx.call.update({
      where: { id: chamada.id },
      data: {
        encerradaEm: momento,
        resultado: atendida ? 'atendida' : 'nao_atendida',
        duracaoSegundos: atendida ? segundosEntre(atendida, momento) : 0,
      },
    });

    return this.sincronizarTimeline(tx, encerrada);
  }

  async listar(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListCallsQueryDto,
  ): Promise<{ items: Call[] }> {
    if (!this.policy.canModule(membership, 'telefonia', 'ver')) {
      return { items: [] };
    }
    const escopo = await this.policy.scopeFilter(tx, membership);
    const items = await tx.call.findMany({
      where: {
        workspaceId: membership.workspaceId,
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...(escopo.ownerUserId ? { userId: escopo.ownerUserId } : {}),
      },
      orderBy: { iniciadaEm: 'desc' },
      take: query.pageSize ?? 20,
    });
    return { items };
  }

  // ───────────────────────────── internos ─────────────────────────────

  private async podeVer(
    tx: TenantTx,
    membership: MembershipContext,
    chamada: Call,
  ): Promise<boolean> {
    if (!this.policy.canModule(membership, 'telefonia', 'ver')) return false;
    return this.policy.can(
      tx,
      membership,
      'read',
      { ownerUserId: chamada.userId },
      'telefonia',
    );
  }

  private async chamadaAberta(
    tx: TenantTx,
    workspaceId: string,
    userId: string,
    e164: string,
  ): Promise<Call | null> {
    const desde = new Date(Date.now() - JANELA_CASAMENTO_MINUTOS * 60_000);
    return tx.call.findFirst({
      where: {
        workspaceId,
        userId,
        telefone: { in: variantesDeBusca(e164) },
        encerradaEm: null,
        iniciadaEm: { gte: desde },
      },
      orderBy: { iniciadaEm: 'desc' },
    });
  }

  // Quando a chamada não nasceu de um clique no CRM, o único vínculo
  // possível é pelo número: procura primeiro um contato, depois a empresa.
  private async vinculoPorTelefone(
    tx: TenantTx,
    workspaceId: string,
    e164: string,
  ): Promise<{ companyId?: string; contactId?: string }> {
    // Comparação por DÍGITOS, no banco: telefone é texto livre nos dois
    // cadastros ("(55) 3220-1234", "55 99999-8888"), então igualdade de
    // string nunca casaria. Trazer as duas tabelas inteiras pra memória a
    // cada evento seria pior — um evento chega a cada ligação.
    const variantes = variantesDeBusca(e164);

    const contato = await tx.$queryRaw<{ id: string; company_id: string }[]>`
      SELECT id, company_id
        FROM contacts
       WHERE workspace_id = ${workspaceId}::uuid
         AND regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') = ANY(${variantes}::text[])
       LIMIT 1`;
    if (contato.length > 0) {
      return { companyId: contato[0].company_id, contactId: contato[0].id };
    }

    const empresa = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id
        FROM companies c
       WHERE c.workspace_id = ${workspaceId}::uuid
         AND c.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM unnest(c.fones) AS fone
            WHERE regexp_replace(fone, '\\D', '', 'g') = ANY(${variantes}::text[])
         )
       LIMIT 1`;
    return empresa.length > 0 ? { companyId: empresa[0].id } : {};
  }

  // Cria (ou reescreve) a Activity que a ficha mostra. Só existe registro
  // na Timeline quando a chamada tem empresa: uma ligação para um número
  // que não é de ninguém do CRM continua no histórico de telefonia, mas
  // não tem ficha onde aparecer.
  private async sincronizarTimeline(tx: TenantTx, chamada: Call): Promise<Call> {
    if (!chamada.encerradaEm || !chamada.companyId) return chamada;

    const contatoNome = chamada.contactId
      ? (
          await tx.contact.findFirst({
            where: { id: chamada.contactId },
            select: { nome: true },
          })
        )?.nome
      : undefined;

    const payload: Record<string, unknown> = {
      texto: textoDoRegistro(chamada),
      subtipo: 'ligacao',
      origem: 'telefonia',
      resultado: chamada.resultado,
      duracaoSegundos: chamada.duracaoSegundos ?? 0,
      ...(contatoNome ? { contatoNome } : {}),
    };

    if (chamada.activityId) {
      await tx.activity.update({
        where: { id: chamada.activityId },
        data: { payload: payload as Prisma.InputJsonValue },
      });
      return chamada;
    }

    const activity = await this.activities.emit(tx, {
      workspaceId: chamada.workspaceId,
      actorUserId: chamada.userId,
      type: 'call',
      payload,
      companyId: chamada.companyId,
      contactId: chamada.contactId,
    });

    return tx.call.update({
      where: { id: chamada.id },
      data: { activityId: activity.id },
    });
  }
}

function segundosEntre(inicio: Date, fim: Date): number {
  return Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 1000));
}

// Texto que aparece na Timeline. Escrito em linguagem de ficha ("Ligação
// atendida — 2 min 13 s"), não em vocabulário de sistema.
export function textoDoRegistro(chamada: Call): string {
  const entrada = chamada.direcao === 'entrada';
  const partes: string[] = [];

  if (chamada.resultado === 'atendida') {
    partes.push(entrada ? 'Ligação recebida' : 'Ligação atendida');
    partes.push(duracaoPorExtenso(chamada.duracaoSegundos ?? 0));
  } else if (chamada.resultado === 'nao_atendida') {
    partes.push(entrada ? 'Ligação perdida' : 'Ligação não atendida');
  } else {
    partes.push('Ligação cancelada');
  }

  const cabecalho = partes.join(' — ');
  const anotacao = chamada.observacao?.trim();
  return anotacao ? `${cabecalho}\n\n${anotacao}` : cabecalho;
}

export function duracaoPorExtenso(segundos: number): string {
  if (segundos < 60) return `${segundos} s`;
  const min = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto ? `${min} min ${resto} s` : `${min} min`;
}

// Chamada que nunca recebeu evento nem encerramento é considerada
// cancelada na leitura (ver JANELA_ABANDONO_MINUTOS) — usado pela tela pra
// não deixar "ligando…" eterno.
export function estaAbandonada(chamada: Call): boolean {
  if (chamada.encerradaEm) return false;
  return (
    Date.now() - chamada.iniciadaEm.getTime() >
    JANELA_ABANDONO_MINUTOS * 60_000
  );
}
