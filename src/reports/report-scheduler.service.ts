import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { diaBR, horarioBR, FUSO_PADRAO } from './report-datas';
import {
  assuntoFollowup,
  assuntoReportDiario,
  montarFollowupHtml,
  montarReportDiarioHtml,
} from './report-template';
import {
  ReportConfigService,
  TIPO_FOLLOWUP,
  TIPO_PIPELINE_DIARIO,
} from './report-config.service';
import { ReportService } from './report.service';
import type { DadosFollowup, DadosReportDiario } from './report.types';

// Mesmo workspace único do resto do projeto (ver
// meta-leads-webhook.service.ts) — o job não tem requisição por trás, então
// resolve por slug.
const WORKSPACE_SLUG = 'gama';

// Ator "sistema" pra app.current_user_id/app.current_role (RLS) — mesmo
// UUID e mesmo racional dos webhooks: não há login Supabase por trás de um
// job agendado, e TenantContextService#run exige UUID válido.
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

export { TIPO_FOLLOWUP, TIPO_PIPELINE_DIARIO };

const CRON_CONFERENCIA_PADRAO = '0 9 * * 1-5';

// O @Cron é um decorator: a expressão é lida quando a CLASSE é carregada,
// antes de qualquer injeção de dependência — por isso aqui é process.env e
// não ConfigService. Expressão inválida faria o processo morrer no import
// (o CRM inteiro fora do ar por causa de uma variável mal digitada), então
// o formato é conferido e, se não bater, vale o padrão com um aviso.
function cronDoAmbiente(nome: string, padrao: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) return padrao;
  const campos = valor.split(/\s+/).length;
  if (campos < 5 || campos > 6) {
    // eslint-disable-next-line no-console
    console.warn(
      `[reports] ${nome}="${valor}" não parece uma expressão cron — usando o padrão "${padrao}".`,
    );
    return padrao;
  }
  return valor;
}

const CRON_CONFERENCIA = cronDoAmbiente(
  'REPORT_CRON_CONFERENCIA',
  CRON_CONFERENCIA_PADRAO,
);
const TIMEZONE = process.env.REPORT_TZ?.trim() || FUSO_PADRAO;

// Tentativas de envio antes de gravar falha. Uma indisponibilidade curta
// do provedor não pode custar o resumo do dia inteiro.
const TENTATIVAS = 2;
const ESPERA_ENTRE_TENTATIVAS_MS = 3_000;

export interface ResultadoEnvio {
  status: 'enviado' | 'falha' | 'ja-enviado' | 'desligado';
  destinatarios: number;
  erro?: string;
  messageId?: string;
}

@Injectable()
export class ReportSchedulerService {
  private readonly logger = new Logger(ReportSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly reports: ReportService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly reportConfig: ReportConfigService,
  ) {}

  // A tela mostra um aviso quando o provedor de e-mail não está
  // configurado — sem isso, o usuário salvaria horários achando que algo
  // vai sair.
  get envioConfigurado(): boolean {
    return this.mail.configurado;
  }

  private get tz(): string {
    return this.config.get<string>('reportTz') ?? FUSO_PADRAO;
  }

  // Um único job, de minuto em minuto, olhando a configuração gravada na
  // tela "E-mail automático" (2026-09-15). Antes cada report tinha seu
  // próprio @Cron com o horário vindo do ambiente — mudar horário exigia
  // deploy, e horário editável na tela não teria como reprogramar o job
  // sem reiniciar o processo. Com o tick, a configuração nova vale no
  // minuto seguinte.
  //
  // O `timeZone` continua obrigatório: é ele que faz "10:00" significar
  // 10h de Brasília num container que roda em UTC.
  //
  // Disparar quatro vezes no mesmo minuto não é risco: cada envio confere
  // o `report_log` antes, e o índice único da tabela é a rede de proteção
  // final.
  // `waitForCompletion`: um tick nunca começa antes de o anterior
  // terminar (um envio pode levar segundos). `unrefTimeout`: o timer não
  // segura o processo vivo sozinho — em produção quem segura é o servidor
  // HTTP, e em teste evita a suíte ficar pendurada depois de fechar a app.
  @Cron('* * * * *', {
    name: 'report-tick',
    timeZone: TIMEZONE,
    waitForCompletion: true,
    unrefTimeout: true,
  })
  async tick(agora: Date = new Date()): Promise<void> {
    const tz = this.tz;
    const workspaceId = await this.resolverWorkspaceId();
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };
    const configs = await this.tenantContext.run(ctx, (tx) =>
      this.reportConfig.listar(tx, workspaceId),
    );

    for (const config of configs) {
      if (!config.ativo) continue;
      if (config.diasUteis && !ehDiaUtil(agora, tz)) continue;

      const slot = slotDoMomento(config.horarios, agora, tz);
      if (!slot) continue;

      if (config.tipo === TIPO_PIPELINE_DIARIO) {
        const resultado = await this.enviarDiario(agora);
        if (resultado.status !== 'ja-enviado') {
          this.logger.log(
            `Resumo diário (${slot}): ${resultado.status} (${resultado.destinatarios} destinatário(s))${
              resultado.erro ? ` — ${resultado.erro}` : ''
            }`,
          );
        }
      } else {
        const resultado = await this.enviarFollowup(agora, slot);
        if (resultado.status !== 'ja-enviado') {
          this.logger.log(
            `Follow-up de cotações (${slot}): ${resultado.status} (${resultado.destinatarios} destinatário(s))${
              resultado.erro ? ` — ${resultado.erro}` : ''
            }`,
          );
        }
      }
    }
  }

  // Conferência de falha silenciosa: report que não sai não gera
  // reclamação — o time só assume que não houve movimento. Roda mais tarde
  // no mesmo dia e avisa se não existir registro de envio.
  @Cron(CRON_CONFERENCIA, {
    name: 'report-conferencia',
    timeZone: TIMEZONE,
    unrefTimeout: true,
  })
  async agendadoConferencia(): Promise<void> {
    await this.conferirEnvioDoDia();
  }

  // Follow-up das cotações. Mesma esteira do resumo diário, com três
  // diferenças: o recorte (só as etapas de proposta), a janela de
  // idempotência (por HORÁRIO, não por dia — são quatro rodadas) e o
  // silêncio quando não há nada (ver abaixo).
  async enviarFollowup(
    agora: Date = new Date(),
    horarioSlot?: string,
  ): Promise<ResultadoEnvio> {
    if (!this.mail.configurado) {
      this.logger.warn(
        'Follow-up não enviado: envio de e-mail não configurado.',
      );
      return { status: 'desligado', destinatarios: 0 };
    }

    const tz = this.tz;
    const dia = diaBR(agora, tz);
    // O rótulo do slot vem da CONFIGURAÇÃO, não do relógio: um tick que
    // atrasa alguns segundos não pode virar uma rodada nova ("10h02") e
    // furar a trava da rodada das 10h.
    const slot = `${dia} ${horarioSlot ? rotuloHorario(horarioSlot) : horarioBR(agora, tz)}`;
    const workspaceId = await this.resolverWorkspaceId();
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };

    const jaEnviado = await this.tenantContext.run(ctx, (tx) =>
      tx.reportLog.findUnique({
        where: {
          workspaceId_tipo_refDia: {
            workspaceId,
            tipo: TIPO_FOLLOWUP,
            refDia: slot,
          },
        },
      }),
    );
    if (jaEnviado?.status === 'enviado') {
      return {
        status: 'ja-enviado',
        destinatarios: jaEnviado.destinatarios,
        messageId: jaEnviado.messageId ?? undefined,
      };
    }

    const coleta = await this.tenantContext.run(ctx, async (tx) => {
      const { etapas, destinatarios } = await this.reportConfig.obter(
        tx,
        workspaceId,
        TIPO_FOLLOWUP,
      );
      return {
        etapas,
        followup: await this.reports.coletarFollowup(
          tx,
          workspaceId,
          etapas,
          agora,
        ),
        elegiveis: await this.reports.membrosElegiveis(
          tx,
          workspaceId,
          destinatarios,
        ),
      };
    });

    // Nome de etapa configurado que não existe no Pipeline: o report sairia
    // vazio sem ninguém entender por quê. Melhor registrar alto.
    if (coleta.followup.etapasEncontradas.length === 0) {
      this.logger.warn(
        `Follow-up: nenhuma oportunidade nas etapas configuradas (${coleta.etapas.join(', ')}). Confira a tela "E-mail automático" contra os nomes das etapas do Pipeline.`,
      );
    }

    // Nada em aberto = nada a acompanhar. Quatro e-mails por dia dizendo
    // "não há cotações" viram ruído e o time para de abrir os que
    // importam. Fica só o registro.
    if (coleta.followup.dados.pipeline.length === 0) {
      await this.gravarLog(ctx, workspaceId, slot, {
        status: 'enviado',
        destinatarios: 0,
        erro: 'Nenhuma cotação nas etapas acompanhadas — envio dispensado.',
        tipo: TIPO_FOLLOWUP,
      });
      return { status: 'enviado', destinatarios: 0 };
    }

    await this.reports.aplicarNomes({
      pipeline: coleta.followup.dados.pipeline,
      fixadas: [],
      tarefas: [],
      userIds: coleta.followup.userIds,
    });
    const { emails } = await this.reports.emailsDe(coleta.elegiveis);

    const dados: DadosFollowup = {
      ...coleta.followup.dados,
      // Rótulo do horário: o da rodada configurada, não o do relógio no
      // instante do envio (que pode ter alguns minutos de atraso).
      horario: horarioSlot
        ? rotuloHorario(horarioSlot)
        : coleta.followup.dados.horario,
      appUrl: this.config.get<string>('reportAppUrl') ?? null,
    };

    if (emails.length === 0) {
      const erro =
        'Nenhum destinatário: nenhum membro de gestão com e-mail de contato cadastrado.';
      await this.gravarLog(ctx, workspaceId, slot, {
        status: 'falha',
        erro,
        destinatarios: 0,
        tipo: TIPO_FOLLOWUP,
      });
      return { status: 'falha', destinatarios: 0, erro };
    }

    const envio = await this.enviarComRetentativa({
      to: emails,
      subject: assuntoFollowup(dados),
      html: montarFollowupHtml(dados),
      idempotencyKey: `report-${TIPO_FOLLOWUP}:${slot}`,
    });

    await this.gravarLog(ctx, workspaceId, slot, {
      status: envio.ok ? 'enviado' : 'falha',
      erro: envio.error,
      messageId: envio.id,
      destinatarios: emails.length,
      tipo: TIPO_FOLLOWUP,
    });

    return {
      status: envio.ok ? 'enviado' : 'falha',
      destinatarios: emails.length,
      erro: envio.error,
      messageId: envio.id,
    };
  }

  // Fluxo completo do envio. Devolve o que aconteceu em vez de lançar —
  // é chamado por um job agendado (exceção não tratada num @Cron morre sem
  // rastro legível) e pelo endpoint manual.
  async enviarDiario(agora: Date = new Date()): Promise<ResultadoEnvio> {
    if (!this.mail.configurado) {
      this.logger.warn(
        'Resumo diário não enviado: envio de e-mail não configurado (RESEND_API_KEY/MAIL_FROM).',
      );
      return { status: 'desligado', destinatarios: 0 };
    }

    const tz = this.tz;
    const dia = diaBR(agora, tz);
    const workspaceId = await this.resolverWorkspaceId();
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };

    // Primeira camada contra duplicidade: já saiu hoje, não faz mais nada
    // (a segunda camada é o índice único de report_log; a terceira é a
    // chave de idempotência no provedor).
    const jaEnviado = await this.tenantContext.run(ctx, (tx) =>
      tx.reportLog.findUnique({
        where: {
          workspaceId_tipo_refDia: {
            workspaceId,
            tipo: TIPO_PIPELINE_DIARIO,
            refDia: dia,
          },
        },
      }),
    );
    if (jaEnviado?.status === 'enviado') {
      return {
        status: 'ja-enviado',
        destinatarios: jaEnviado.destinatarios,
        messageId: jaEnviado.messageId ?? undefined,
      };
    }

    // Leitura do banco numa transação; nomes e e-mails (chamada HTTP ao
    // Supabase Auth) fora dela — ver comentário em ReportService.
    const coleta = await this.tenantContext.run(ctx, async (tx) => {
      const { destinatarios } = await this.reportConfig.obter(
        tx,
        workspaceId,
        TIPO_PIPELINE_DIARIO,
      );
      return {
        dados: await this.reports.coletarDiario(tx, workspaceId, agora),
        elegiveis: await this.reports.membrosElegiveis(
          tx,
          workspaceId,
          destinatarios,
        ),
      };
    });

    await this.reports.aplicarNomes(coleta.dados);
    const { emails, semEmail } = await this.reports.emailsDe(coleta.elegiveis);

    if (semEmail.length > 0) {
      // Membro de gestão sem e-mail de contato preenchido simplesmente não
      // recebe — fica no log pra que isso seja corrigível na tela de
      // Membros, em vez de virar "não chegou pra mim" sem explicação.
      this.logger.warn(
        `Resumo diário: ${semEmail.length} membro(s) de gestão sem e-mail de contato cadastrado.`,
      );
    }

    const dados: DadosReportDiario = {
      ...coleta.dados,
      appUrl: this.config.get<string>('reportAppUrl') ?? null,
    };

    if (emails.length === 0) {
      const erro =
        'Nenhum destinatário: nenhum membro de gestão com e-mail de contato cadastrado.';
      await this.gravarLog(ctx, workspaceId, dia, {
        status: 'falha',
        erro,
        destinatarios: 0,
      });
      return { status: 'falha', destinatarios: 0, erro };
    }

    const envio = await this.enviarComRetentativa({
      to: emails,
      subject: assuntoReportDiario(dados),
      html: montarReportDiarioHtml(dados),
      // Formato do plano: expira em 24h no provedor, o que casa com a
      // cadência diária. Redeploy no horário do disparo não gera segundo
      // e-mail nem que a checagem acima falhe.
      idempotencyKey: `report-${TIPO_PIPELINE_DIARIO}:${dia}`,
    });

    await this.gravarLog(ctx, workspaceId, dia, {
      status: envio.ok ? 'enviado' : 'falha',
      erro: envio.error,
      messageId: envio.id,
      destinatarios: emails.length,
    });

    return {
      status: envio.ok ? 'enviado' : 'falha',
      destinatarios: emails.length,
      erro: envio.error,
      messageId: envio.id,
    };
  }

  // Envio isolado pra uma pessoa só, sem tocar no report_log — é o que
  // permite conferir remetente, "responder para" e layout sem gastar o
  // envio do dia nem enganar a conferência.
  async enviarTeste(
    destinatario: string,
    agora: Date = new Date(),
  ): Promise<ResultadoEnvio> {
    if (!this.mail.configurado) {
      return { status: 'desligado', destinatarios: 0 };
    }

    const workspaceId = await this.resolverWorkspaceId();
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };

    const coleta = await this.tenantContext.run(ctx, (tx) =>
      this.reports.coletarDiario(tx, workspaceId, agora),
    );
    await this.reports.aplicarNomes(coleta);

    const dados: DadosReportDiario = {
      ...coleta,
      appUrl: this.config.get<string>('reportAppUrl') ?? null,
    };

    const envio = await this.mail.send({
      to: [destinatario],
      subject: `[teste] ${assuntoReportDiario(dados)}`,
      html: montarReportDiarioHtml(dados),
      // Sem chave de idempotência de propósito: dois testes seguidos
      // precisam chegar os dois.
    });

    return {
      status: envio.ok ? 'enviado' : 'falha',
      destinatarios: 1,
      erro: envio.error,
      messageId: envio.id,
    };
  }

  // Follow-up para um endereço só, sem registrar nada — mesmo papel do
  // enviarTeste do resumo diário.
  async enviarFollowupTeste(
    destinatario: string,
    agora: Date = new Date(),
  ): Promise<ResultadoEnvio> {
    if (!this.mail.configurado) {
      return { status: 'desligado', destinatarios: 0 };
    }

    const workspaceId = await this.resolverWorkspaceId();
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };
    const etapas = this.config.get<string[]>('reportFollowupEtapas') ?? [];

    const coleta = await this.tenantContext.run(ctx, (tx) =>
      this.reports.coletarFollowup(tx, workspaceId, etapas, agora),
    );
    await this.reports.aplicarNomes({
      pipeline: coleta.dados.pipeline,
      fixadas: [],
      tarefas: [],
      userIds: coleta.userIds,
    });

    const dados: DadosFollowup = {
      ...coleta.dados,
      appUrl: this.config.get<string>('reportAppUrl') ?? null,
    };

    const envio = await this.mail.send({
      to: [destinatario],
      subject: `[teste] ${assuntoFollowup(dados)}`,
      html: montarFollowupHtml(dados),
    });

    return {
      status: envio.ok ? 'enviado' : 'falha',
      destinatarios: 1,
      erro: envio.error,
      messageId: envio.id,
    };
  }

  // Avisa quando o resumo do dia não saiu. Não tenta reenviar: se o envio
  // falhou por credencial ou domínio, reenviar falharia igual — o que
  // resolve é alguém olhar.
  async conferirEnvioDoDia(agora: Date = new Date()): Promise<boolean> {
    if (!this.mail.configurado) return false;

    const tz = this.tz;
    const dia = diaBR(agora, tz);
    const workspaceId = await this.resolverWorkspaceId();
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };

    const { config, log } = await this.tenantContext.run(ctx, async (tx) => ({
      config: await this.reportConfig.obter(tx, workspaceId, TIPO_PIPELINE_DIARIO),
      log: await tx.reportLog.findUnique({
        where: {
          workspaceId_tipo_refDia: {
            workspaceId,
            tipo: TIPO_PIPELINE_DIARIO,
            refDia: dia,
          },
        },
      }),
    }));
    // Resumo desligado na tela, ou dia não útil com a regra de dias úteis
    // ligada: não há o que conferir — cobrar um envio que ninguém pediu
    // seria alarme falso diário.
    if (!config.ativo) return true;
    if (config.diasUteis && !ehDiaUtil(agora, tz)) return true;
    if (log?.status === 'enviado') return true;

    const destinatarios = await this.enderecosDeAlerta(ctx, workspaceId);
    if (destinatarios.length === 0) {
      this.logger.error(
        `Resumo diário de ${dia} não saiu e não há endereço para avisar.`,
      );
      return false;
    }

    const motivo = log?.erro ?? 'o envio não chegou a ser registrado.';
    this.logger.error(`Resumo diário de ${dia} não saiu — ${motivo}`);

    await this.mail.send({
      to: destinatarios,
      subject: `[CRM] O resumo diário de ${dia} não foi enviado`,
      html: `<p style="font-family: Arial, sans-serif; font-size: 14px; color: #1a1e24;">O resumo diário do Pipeline de <strong>${dia}</strong> não foi enviado.</p>
<p style="font-family: Arial, sans-serif; font-size: 14px; color: #5b6472;">Motivo registrado: ${motivo}</p>
<p style="font-family: Arial, sans-serif; font-size: 13px; color: #838c99;">Aviso automático do CRM da Gama Brasil.</p>`,
      idempotencyKey: `report-alerta-${TIPO_PIPELINE_DIARIO}:${dia}`,
    });
    return false;
  }

  private async enviarComRetentativa(params: {
    to: string[];
    subject: string;
    html: string;
    idempotencyKey: string;
  }) {
    let ultimo = await this.mail.send(params);
    for (let tentativa = 2; !ultimo.ok && tentativa <= TENTATIVAS; tentativa++) {
      await new Promise((r) => setTimeout(r, ESPERA_ENTRE_TENTATIVAS_MS));
      this.logger.warn(
        `Resumo diário: tentativa ${tentativa} de ${TENTATIVAS} após "${ultimo.error}".`,
      );
      // Mesma chave de idempotência nas duas tentativas de propósito: se a
      // primeira chegou a entrar no provedor e só a resposta se perdeu, a
      // repetição não vira um segundo e-mail.
      ultimo = await this.mail.send(params);
    }
    return ultimo;
  }

  private async gravarLog(
    ctx: { userId: string; workspaceId: string; role: 'owner' },
    workspaceId: string,
    dia: string,
    dados: {
      status: 'enviado' | 'falha';
      erro?: string;
      messageId?: string;
      destinatarios: number;
      // Qual report está sendo registrado — o diário quando omitido.
      tipo?: string;
    },
  ): Promise<void> {
    const tipo = dados.tipo ?? TIPO_PIPELINE_DIARIO;
    await this.tenantContext.run(ctx, (tx) =>
      tx.reportLog.upsert({
        where: {
          workspaceId_tipo_refDia: {
            workspaceId,
            tipo,
            refDia: dia,
          },
        },
        create: {
          workspaceId,
          tipo,
          refDia: dia,
          status: dados.status,
          erro: dados.erro ?? null,
          messageId: dados.messageId ?? null,
          destinatarios: dados.destinatarios,
        },
        update: {
          status: dados.status,
          erro: dados.erro ?? null,
          messageId: dados.messageId ?? null,
          destinatarios: dados.destinatarios,
        },
      }),
    );
  }

  // Quem recebe o aviso de falha: a lista explícita, se houver; senão o
  // primeiro destinatário normal do report (um gestor recebendo "o resumo
  // não saiu" é melhor do que ninguém saber).
  private async enderecosDeAlerta(
    ctx: { userId: string; workspaceId: string; role: 'owner' },
    workspaceId: string,
  ): Promise<string[]> {
    const fixos = this.config.get<string[]>('reportAlertaTo') ?? [];
    if (fixos.length > 0) return fixos;

    const elegiveis = await this.tenantContext.run(ctx, (tx) =>
      this.reports.membrosElegiveis(tx, workspaceId),
    );
    const { emails } = await this.reports.emailsDe(elegiveis);
    return emails.slice(0, 1);
  }

  private async resolverWorkspaceId(): Promise<string> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });
    return workspace.id;
  }
}

// Segunda a sexta no fuso do report — o container roda em UTC, então o dia
// da semana precisa ser lido no fuso certo (às 21h de sexta em Brasília já
// é sábado em UTC).
function ehDiaUtil(agora: Date, tz: string): boolean {
  const dia = agora.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
  });
  return !['Sat', 'Sun'].includes(dia);
}

// Janela de tolerância do tick: se o processo estava ocupado (ou subindo)
// no minuto exato do disparo, ainda dá pra recuperar nos minutos
// seguintes. A trava de report_log garante que recuperar não vira
// duplicata.
const JANELA_MINUTOS = 5;

// Qual horário configurado corresponde a "agora", se algum.
export function slotDoMomento(
  horarios: string[],
  agora: Date,
  tz: string,
): string | null {
  const [hora, minuto] = agora
    .toLocaleTimeString('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .split(':')
    .map(Number);
  const minutosAgora = hora * 60 + minuto;

  for (const horario of horarios) {
    const [h, m] = horario.split(':').map(Number);
    if (!Number.isInteger(h) || !Number.isInteger(m)) continue;
    const atraso = minutosAgora - (h * 60 + m);
    if (atraso >= 0 && atraso <= JANELA_MINUTOS) return horario;
  }
  return null;
}

// "10:00" → "10h"; "11:50" → "11h50". É como o horário aparece no assunto
// e no registro de envios.
export function rotuloHorario(horario: string): string {
  const [hora, minuto] = horario.split(':');
  return minuto === '00' ? `${hora}h` : `${hora}h${minuto}`;
}
