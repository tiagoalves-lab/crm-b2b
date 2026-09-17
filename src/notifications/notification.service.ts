import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { COMPANY_REF_SELECT, type CompanyRef } from '../companies/company-ref';
import { MailService } from '../mail/mail.service';
import { SupabaseUserService } from '../memberships/supabase-user.service';
import { diaCurtoBR, diferencaEmDias, FUSO_PADRAO } from '../reports/report-datas';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  assuntoMencao,
  assuntoTarefaAtribuida,
  montarMencaoHtml,
  montarTarefaAtribuidaHtml,
} from './notification-template';

// Ator "sistema" pra app.current_user_id/app.current_role (RLS) — mesmo
// UUID e mesmo racional dos webhooks e do agendador de reports: o aviso
// sai fora da requisição, sem membership por trás.
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

// Avisos pontuais por e-mail (pedido do usuário, 2026-09-15): tarefa
// designada a alguém e membro destacado numa anotação.
//
// Três decisões de desenho que explicam o formato deste arquivo:
//
// 1. **Nunca dentro da transação.** Quem chama (TaskService,
//    OpportunityCommentService) está no meio de uma `$transaction` do
//    Postgres. Segurar a transação aberta esperando uma chamada HTTP é
//    como o pool de conexões já estourou neste projeto. Por isso o
//    trabalho real é adiado com `setImmediate` e roda depois que a
//    requisição já respondeu.
//
// 2. **Relê o registro antes de enviar.** Adiar cria um risco: a
//    transação pode ter dado rollback DEPOIS do agendamento, e o aviso
//    falaria de uma tarefa que não existe. Então o envio só acontece se o
//    registro estiver lá, com o mesmo responsável/destaque — uma leitura
//    barata por índice que troca esse risco por nada.
//
// 3. **Nunca derruba a ação do usuário.** Todo erro é engolido e vira
//    log: salvar a tarefa não pode falhar porque o e-mail falhou.
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly mail: MailService,
    private readonly supabaseUsers: SupabaseUserService,
    private readonly config: ConfigService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('reportTz') ?? FUSO_PADRAO;
  }

  private get appUrl(): string | null {
    return this.config.get<string>('reportAppUrl') ?? null;
  }

  // Tarefa designada a alguém. Não avisa quem criou a tarefa pra si mesmo
  // — a pessoa acabou de digitar, não precisa de e-mail contando.
  avisarTarefaAtribuida(params: {
    workspaceId: string;
    taskId: string;
    assigneeUserId: string;
    actorUserId: string;
  }): void {
    if (params.assigneeUserId === params.actorUserId) return;
    this.agendar(() => this.enviarTarefaAtribuida(params));
  }

  // Membro destacado numa anotação do card. Quem escreveu não recebe
  // aviso de se destacar.
  avisarMencao(params: {
    workspaceId: string;
    commentId: string;
    userIds: string[];
    actorUserId: string;
  }): void {
    const alvos = params.userIds.filter((id) => id !== params.actorUserId);
    if (alvos.length === 0) return;
    this.agendar(() => this.enviarMencao({ ...params, userIds: alvos }));
  }

  private agendar(trabalho: () => Promise<void>): void {
    if (!this.mail.configurado) return;
    setImmediate(() => {
      void trabalho().catch((err: unknown) => {
        this.logger.warn(
          `Falha ao enviar aviso por e-mail: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    });
  }

  private contextoSistema(workspaceId: string) {
    return {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };
  }

  private async enviarTarefaAtribuida(params: {
    workspaceId: string;
    taskId: string;
    assigneeUserId: string;
    actorUserId: string;
  }): Promise<void> {
    const ctx = this.contextoSistema(params.workspaceId);
    const task = await this.tenantContext.run(ctx, (tx) =>
      tx.task.findUnique({
        where: { id: params.taskId },
        include: {
          company: { select: COMPANY_REF_SELECT },
          opportunity: {
            select: { company: { select: COMPANY_REF_SELECT } },
          },
        },
      }),
    );
    // Transação revertida, tarefa apagada ou responsável já trocado de
    // novo: não existe mais o fato que o aviso contaria.
    if (!task || task.assigneeUserId !== params.assigneeUserId) return;

    const identidades = await this.supabaseUsers.getIdentities([
      params.assigneeUserId,
      params.actorUserId,
    ]);
    const destino = identidades.get(params.assigneeUserId)?.email?.trim();
    if (!destino || !destino.includes('@')) {
      this.logger.warn(
        `Tarefa ${task.id}: responsável sem e-mail de contato cadastrado, aviso não enviado.`,
      );
      return;
    }

    const prazo = task.dueAt ? diaCurtoBR(task.dueAt, this.tz) : null;
    const aviso = {
      titulo: task.title,
      empresa: nomeEmpresa(task.company ?? task.opportunity?.company ?? null),
      prazo,
      atrasada: task.dueAt
        ? diferencaEmDias(task.dueAt, new Date(), this.tz) > 0
        : false,
      tipo: task.tipo ? rotuloTipo(task.tipo) : null,
      descricao: task.description,
      designadoPor: nomeDe(identidades.get(params.actorUserId)),
      url: this.appUrl ? `${this.appUrl}/dashboard/tarefas/${task.id}` : null,
    };

    const resultado = await this.mail.send({
      to: [destino],
      subject: assuntoTarefaAtribuida(aviso),
      html: montarTarefaAtribuidaHtml(aviso),
    });
    if (!resultado.ok) {
      this.logger.warn(`Tarefa ${task.id}: aviso não saiu — ${resultado.error}`);
    }
  }

  private async enviarMencao(params: {
    workspaceId: string;
    commentId: string;
    userIds: string[];
    actorUserId: string;
  }): Promise<void> {
    const ctx = this.contextoSistema(params.workspaceId);
    const comment = await this.tenantContext.run(ctx, (tx) =>
      tx.opportunityComment.findUnique({
        where: { id: params.commentId },
        include: {
          opportunity: {
            select: { id: true, company: { select: COMPANY_REF_SELECT } },
          },
        },
      }),
    );
    if (!comment) return;

    // Só quem continua destacado no comentário gravado.
    const alvos = params.userIds.filter((id) =>
      comment.mentionedUserIds.includes(id),
    );
    if (alvos.length === 0) return;

    const identidades = await this.supabaseUsers.getIdentities([
      ...alvos,
      params.actorUserId,
    ]);
    const aviso = {
      empresa: nomeEmpresa(comment.opportunity.company),
      autor: comment.externalAuthor ?? nomeDe(identidades.get(comment.authorUserId)),
      texto: comment.body,
      url: this.appUrl
        ? `${this.appUrl}/dashboard/pipeline/${comment.opportunity.id}`
        : null,
    };
    const html = montarMencaoHtml(aviso);
    const assunto = assuntoMencao(aviso);

    // Um e-mail por pessoa, não um com todo mundo em cópia: o texto fala
    // "você", e ninguém precisa ver o endereço dos colegas.
    for (const userId of alvos) {
      const destino = identidades.get(userId)?.email?.trim();
      if (!destino || !destino.includes('@')) {
        this.logger.warn(
          `Anotação ${comment.id}: destacado sem e-mail de contato cadastrado, aviso não enviado.`,
        );
        continue;
      }
      const resultado = await this.mail.send({
        to: [destino],
        subject: assunto,
        html,
      });
      if (!resultado.ok) {
        this.logger.warn(
          `Anotação ${comment.id}: aviso não saiu — ${resultado.error}`,
        );
      }
    }
  }
}

// Mesma ordem de prioridade de companyDisplayName() no frontend.
function nomeEmpresa(company: CompanyRef | null): string {
  if (!company) return 'Sem empresa';
  return (
    company.fantasia?.trim() ||
    company.razaoSocial?.trim() ||
    company.nomeParaContato?.trim() ||
    'Empresa sem nome'
  );
}

function nomeDe(identidade?: { name: string | null; login: string }): string {
  return identidade?.name?.trim() || identidade?.login?.trim() || 'Alguém';
}

const ROTULO_TIPO: Record<string, string> = {
  ligacao: 'Ligação',
  email: 'E-mail',
  visita: 'Visita',
  proposta: 'Proposta',
  followup: 'Follow-up',
  reuniao: 'Reunião',
};

function rotuloTipo(tipo: string): string {
  return ROTULO_TIPO[tipo] ?? tipo;
}
