import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantTx } from '../tenancy/tenant-context.service';

export const TIPO_PIPELINE_DIARIO = 'pipeline-diario';
export const TIPO_FOLLOWUP = 'pipeline-followup';
// Aviso de lead novo do Meta (2026-09-18). Mora aqui junto dos reports
// agendados por um motivo só: é a mesma pergunta de configuração ("está
// ligado?" e "quem recebe?") e a mesma tela. O que ele NÃO tem é horário —
// sai no instante em que o lead entra, não em rodada.
export const TIPO_LEAD_META = 'lead-meta';

export const TIPOS_CONFIGURAVEIS = [
  TIPO_PIPELINE_DIARIO,
  TIPO_FOLLOWUP,
  TIPO_LEAD_META,
] as const;

// Os tipos que o tick do agendador olha. O aviso de lead é disparado por
// evento, então fica de fora — sem esta lista, um horário salvo por engano
// no registro dele faria o tick tentar mandar um follow-up.
export const TIPOS_AGENDADOS: readonly string[] = [
  TIPO_PIPELINE_DIARIO,
  TIPO_FOLLOWUP,
];
export type TipoReport = (typeof TIPOS_CONFIGURAVEIS)[number];

export interface ConfigReport {
  tipo: TipoReport;
  ativo: boolean;
  horarios: string[];
  diasUteis: boolean;
  etapas: string[];
  // Vazio = todos os elegíveis (padrão). Preenchido = só estes user_ids.
  destinatarios: string[];
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

// "10:00" — único formato aceito. Guardar "10h" ou "10:0" faria o
// agendador errar o disparo em silêncio.
const HORARIO_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_HORARIOS = 8;

export function normalizarHorario(valor: string): string {
  const texto = valor.trim();
  const casado = /^(\d{1,2})[:h]?(\d{2})$/.exec(texto);
  if (!casado) {
    throw new BadRequestException(
      `Horário inválido: "${valor}". Use o formato HH:MM (ex.: 10:00).`,
    );
  }
  const hora = casado[1].padStart(2, '0');
  const normalizado = `${hora}:${casado[2]}`;
  if (!HORARIO_RE.test(normalizado)) {
    throw new BadRequestException(
      `Horário inválido: "${valor}". Use o formato HH:MM (ex.: 10:00).`,
    );
  }
  return normalizado;
}

// Configuração dos reports por e-mail. Mora no banco (report_config) pra
// que a tela "E-mail automático" mude horário sem deploy; a variável de
// ambiente virou só o PADRÃO de quem nunca salvou nada — é o que estava
// valendo antes da tela existir, então quem não mexer em nada continua
// com o mesmo comportamento.
@Injectable()
export class ReportConfigService {
  constructor(private readonly config: ConfigService) {}

  private padrao(tipo: TipoReport): ConfigReport {
    if (tipo === TIPO_LEAD_META) {
      return {
        tipo,
        ativo: true,
        horarios: [],
        diasUteis: false,
        etapas: [],
        destinatarios: [],
        atualizadoEm: null,
        atualizadoPor: null,
      };
    }
    if (tipo === TIPO_FOLLOWUP) {
      return {
        tipo,
        ativo: true,
        horarios: this.config.get<string[]>('reportFollowupHorarios') ?? [],
        diasUteis: true,
        etapas: this.config.get<string[]>('reportFollowupEtapas') ?? [],
        destinatarios: [],
        atualizadoEm: null,
        atualizadoPor: null,
      };
    }
    return {
      tipo,
      ativo: true,
      // O resumo diário nasceu com o horário numa expressão cron
      // (REPORT_CRON_PIPELINE, "0 8 * * 1-5"); aqui vira "08:00".
      horarios: [horarioDoCron(this.config.get<string>('reportCronPipeline'))],
      diasUteis: true,
      etapas: [],
      destinatarios: [],
      atualizadoEm: null,
      atualizadoPor: null,
    };
  }

  async listar(tx: TenantTx, workspaceId: string): Promise<ConfigReport[]> {
    const linhas = await tx.reportConfig.findMany({ where: { workspaceId } });
    const porTipo = new Map(linhas.map((l) => [l.tipo, l]));

    return TIPOS_CONFIGURAVEIS.map((tipo) => {
      const linha = porTipo.get(tipo);
      if (!linha) return this.padrao(tipo);
      return {
        tipo,
        ativo: linha.ativo,
        horarios: linha.horarios,
        diasUteis: linha.diasUteis,
        etapas: linha.etapas,
        destinatarios: linha.destinatarios,
        atualizadoEm: linha.atualizadoEm.toISOString(),
        atualizadoPor: linha.atualizadoPor,
      };
    });
  }

  async obter(
    tx: TenantTx,
    workspaceId: string,
    tipo: TipoReport,
  ): Promise<ConfigReport> {
    const todas = await this.listar(tx, workspaceId);
    return todas.find((c) => c.tipo === tipo) ?? this.padrao(tipo);
  }

  async salvar(
    tx: TenantTx,
    workspaceId: string,
    tipo: TipoReport,
    userId: string,
    patch: {
      ativo?: boolean;
      horarios?: string[];
      diasUteis?: boolean;
      etapas?: string[];
      destinatarios?: string[];
    },
  ): Promise<ConfigReport> {
    const atual = await this.obter(tx, workspaceId, tipo);

    // Aviso por evento não tem horário nem dia útil: sai quando o lead
    // chega, inclusive no fim de semana (o anúncio roda sábado e domingo).
    // Guardar horário aqui só criaria configuração que não faz nada.
    if (tipo === TIPO_LEAD_META) {
      return this.gravar(tx, workspaceId, tipo, userId, {
        ativo: patch.ativo ?? atual.ativo,
        horarios: [],
        diasUteis: false,
        etapas: [],
        destinatarios: await this.validarDestinatarios(
          tx,
          workspaceId,
          patch.destinatarios,
          atual.destinatarios,
        ),
      });
    }

    const horarios =
      patch.horarios !== undefined
        ? [...new Set(patch.horarios.map(normalizarHorario))].sort()
        : atual.horarios;
    if (horarios.length > MAX_HORARIOS) {
      throw new BadRequestException(
        `No máximo ${MAX_HORARIOS} horários por report.`,
      );
    }
    // Resumo diário é um envio só por dia — dois horários gerariam dois
    // e-mails competindo pela mesma trava de "um por dia", e o segundo
    // nunca sairia. Melhor recusar do que deixar o usuário achar que
    // configurou algo que não funciona.
    if (tipo === TIPO_PIPELINE_DIARIO && horarios.length > 1) {
      throw new BadRequestException(
        'O resumo diário tem um horário só. Para vários disparos por dia, use o follow-up de cotações.',
      );
    }
    const ativo = patch.ativo ?? atual.ativo;
    if (ativo && horarios.length === 0) {
      throw new BadRequestException(
        'Informe pelo menos um horário para deixar o report ativo.',
      );
    }

    const etapas =
      patch.etapas !== undefined
        ? [...new Set(patch.etapas.map((e) => e.trim()).filter(Boolean))]
        : atual.etapas;
    if (tipo === TIPO_FOLLOWUP && ativo && etapas.length === 0) {
      throw new BadRequestException(
        'Escolha pelo menos uma etapa do Pipeline para o follow-up.',
      );
    }

    // Só quem é ELEGÍVEL pode entrar na lista — a checagem é aqui, no
    // servidor, e não na tela: sem isso, um id qualquer no formulário
    // colocaria um representante (ou alguém de outro workspace) recebendo
    // o panorama inteiro da empresa.
    const destinatarios = await this.validarDestinatarios(
      tx,
      workspaceId,
      patch.destinatarios,
      atual.destinatarios,
    );

    return this.gravar(tx, workspaceId, tipo, userId, {
      ativo,
      horarios,
      diasUteis: patch.diasUteis ?? atual.diasUteis,
      etapas,
      destinatarios,
    });
  }

  private async validarDestinatarios(
    tx: TenantTx,
    workspaceId: string,
    pedido: string[] | undefined,
    atual: string[],
  ): Promise<string[]> {
    if (pedido === undefined) return atual;
    const pedidos = [...new Set(pedido.filter(Boolean))];
    if (pedidos.length > 0) {
      const elegiveis = await tx.membership.findMany({
        where: {
          workspaceId,
          status: 'active',
          role: { not: 'sales_rep' },
          userId: { in: pedidos },
        },
        select: { userId: true },
      });
      const validos = new Set(elegiveis.map((m) => m.userId));
      const invalido = pedidos.find((id) => !validos.has(id));
      if (invalido) {
        throw new BadRequestException(
          'Só é possível escolher membros ativos que não sejam representantes.',
        );
      }
    }
    return pedidos;
  }

  private async gravar(
    tx: TenantTx,
    workspaceId: string,
    tipo: TipoReport,
    userId: string,
    dados: {
      ativo: boolean;
      horarios: string[];
      diasUteis: boolean;
      etapas: string[];
      destinatarios: string[];
    },
  ): Promise<ConfigReport> {
    const linha = await tx.reportConfig.upsert({
      where: { workspaceId_tipo: { workspaceId, tipo } },
      create: { workspaceId, tipo, ...dados, atualizadoPor: userId },
      update: { ...dados, atualizadoPor: userId },
    });

    return {
      tipo,
      ativo: linha.ativo,
      horarios: linha.horarios,
      diasUteis: linha.diasUteis,
      etapas: linha.etapas,
      destinatarios: linha.destinatarios,
      atualizadoEm: linha.atualizadoEm.toISOString(),
      atualizadoPor: linha.atualizadoPor,
    };
  }
}

// "0 8 * * 1-5" → "08:00". Só pra migrar o padrão antigo; expressão fora
// do formato simples cai no 08:00, que é o horário que sempre valeu.
function horarioDoCron(cron: string | undefined): string {
  const campos = (cron ?? '').trim().split(/\s+/);
  if (campos.length < 2) return '08:00';
  const minuto = Number(campos[0]);
  const hora = Number(campos[1]);
  if (!Number.isInteger(minuto) || !Number.isInteger(hora)) return '08:00';
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}
