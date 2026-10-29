import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { COMPANY_REF_SELECT, type CompanyRef } from '../companies/company-ref';
import { SupabaseUserService } from '../memberships/supabase-user.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import {
  dataExtensoBR,
  diaBR,
  diaComSemanaCurto,
  diaCurtoBR,
  diaDoPrazo,
  diaSemanaBR,
  diasEntre,
  domingoDaSemana,
  horarioBR,
  somarDias,
  FUSO_PADRAO,
} from './report-datas';
import { diasDeSla } from '../opportunities/opportunity-sla';
import type {
  AnotacaoFixada,
  DadosFollowup,
  DadosReportDiario,
  EtapaResumo,
  LinhaPipeline,
  TarefaPendente,
} from './report.types';

// Tetos por seção — o e-mail é um resumo, não um relatório completo. Hoje
// o CRM tem ~10 oportunidades abertas e passa longe disso; os limites
// existem pra que o dia em que a base crescer não gere um e-mail de 15
// páginas (e o rodapé de cada seção avisa quantos ficaram de fora).
const MAX_LINHAS_PIPELINE = 40;
const MAX_FIXADAS = 8;
// Recorte W0/W+1 desde 2026-10-22 — o teto só segura um acúmulo grande de
// atrasadas.
const MAX_TAREFAS = 40;

// Mesma ordem de prioridade de companyDisplayName() no frontend
// (web/lib/api/companies.ts): fantasia > razão social > nome pra contato.
function nomeEmpresa(company: CompanyRef | null): string {
  if (!company) return 'Empresa sem nome';
  return (
    company.fantasia?.trim() ||
    company.razaoSocial?.trim() ||
    company.nomeParaContato?.trim() ||
    'Empresa sem nome'
  );
}

@Injectable()
export class ReportService {
  constructor(
    private readonly config: ConfigService,
    private readonly supabaseUsers: SupabaseUserService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('reportTz') ?? FUSO_PADRAO;
  }

  // Lê tudo que o resumo diário mostra. Roda dentro de uma transação com
  // contexto de sistema (papel owner) — o report é o mesmo pra todo mundo
  // que recebe, porque a lista de destinatários já exclui representante
  // (decisão do usuário, 2026-09-15: "gerente para cima recebe todos").
  //
  // A resolução de NOMES (representante, autor da anotação, responsável
  // pela tarefa) fica de fora desta transação de propósito: é uma chamada
  // HTTP ao Supabase Auth, e segurar a transação aberta esperando a rede
  // é exatamente como o pool de conexões estourou antes neste projeto.
  async coletarDiario(
    tx: TenantTx,
    workspaceId: string,
    agora: Date = new Date(),
  ): Promise<Omit<DadosReportDiario, 'appUrl'> & { userIds: string[] }> {
    const tz = this.tz;

    const [oportunidades, fixadasRaw, tarefasRaw] = await Promise.all([
      tx.opportunity.findMany({
        where: { workspaceId, deletedAt: null, status: 'open' },
        include: {
          company: { select: COMPANY_REF_SELECT },
          stage: { select: { name: true, order: true } },
          items: {
            select: { name: true },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
      tx.opportunityComment.findMany({
        where: {
          pinnedAt: { not: null },
          opportunity: { workspaceId, deletedAt: null },
        },
        orderBy: { pinnedAt: 'desc' },
        take: MAX_FIXADAS,
        include: {
          opportunity: {
            select: { company: { select: COMPANY_REF_SELECT } },
          },
        },
      }),
      tx.task.findMany({
        where: { workspaceId, status: 'pending' },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        include: {
          company: { select: COMPANY_REF_SELECT },
          opportunity: {
            select: { company: { select: COMPANY_REF_SELECT } },
          },
        },
      }),
    ]);

    // ── Pipeline ────────────────────────────────────────────────────
    // Mesma ordem do quadro (ordemDoQuadro). A numeração `nr` sai daí.
    const ordenadas = [...oportunidades].sort(ordemDoQuadro);

    const pipeline: LinhaPipeline[] = ordenadas
      .slice(0, MAX_LINHAS_PIPELINE)
      .map((opp, indice) => this.linhaDe(opp, indice + 1, agora, tz));

    const etapasMap = new Map<number, EtapaResumo>();
    for (const opp of ordenadas) {
      const atual = etapasMap.get(opp.stage.order) ?? {
        nome: opp.stage.name,
        ordem: opp.stage.order,
        quantidade: 0,
        valor: 0,
      };
      atual.quantidade += 1;
      atual.valor += Number(opp.amount);
      etapasMap.set(opp.stage.order, atual);
    }
    const etapas = [...etapasMap.values()].sort((a, b) => a.ordem - b.ordem);

    const totalEmAberto = ordenadas.reduce(
      (soma, opp) => soma + Number(opp.amount),
      0,
    );
    const semValorDefinido = ordenadas.filter(
      (opp) => Number(opp.amount) <= 0,
    ).length;

    // ── Anotações fixadas ───────────────────────────────────────────
    const fixadas: AnotacaoFixada[] = fixadasRaw.map((c) => ({
      empresa: nomeEmpresa(c.opportunity.company),
      texto: c.body,
      // Quem comentou de fora (espelho do Trello) não tem usuário no CRM:
      // o nome real vem em externalAuthor, não do Supabase Auth.
      autor: c.externalAuthor ?? c.authorUserId,
      fixadoEm: c.pinnedAt ? diaCurtoBR(c.pinnedAt, tz) : '',
    }));

    // ── Tarefas pendentes ───────────────────────────────────────────
    // Recorte W0/W+1 (pedido do usuário, 2026-10-22): atrasadas, desta
    // semana e da próxima, semana de segunda a domingo. Sem prazo ou com
    // prazo depois do domingo da próxima semana fica de fora da lista.
    const hoje = diaBR(agora, tz);
    const fimDaSemana = domingoDaSemana(hoje);
    const fimDaProxima = somarDias(fimDaSemana, 7);

    const noRecorte = tarefasRaw
      .flatMap((t) => {
        if (!t.dueAt) return [];
        const dia = diaDoPrazo(t.dueAt, t.dueHasTime, tz);
        const grupo: TarefaPendente['grupo'] | null =
          dia < hoje
            ? 'atrasada'
            : dia <= fimDaSemana
              ? 'semana'
              : dia <= fimDaProxima
                ? 'proxima-semana'
                : null;
        return grupo ? [{ t, dia, grupo }] : [];
      })
      // Pelo DIA, não pelo instante: prazo só-data (meia-noite UTC) e
      // reunião com hora não se ordenam direito entre si pelo dueAt cru.
      .sort((a, b) => a.dia.localeCompare(b.dia));

    const tarefas: TarefaPendente[] = noRecorte
      .slice(0, MAX_TAREFAS)
      .map(({ t, dia, grupo }) => {
        const atraso = diasEntre(dia, hoje);
        return {
          titulo: t.title,
          empresa: t.company
            ? nomeEmpresa(t.company)
            : t.opportunity?.company
              ? nomeEmpresa(t.opportunity.company)
              : null,
          responsavel: t.assigneeUserId,
          grupo,
          quando:
            atraso > 0
              ? `${atraso} ${atraso === 1 ? 'dia' : 'dias'}`
              : atraso === 0
                ? 'hoje'
                : diaComSemanaCurto(dia),
        };
      });

    const tarefasAtrasadas = noRecorte.filter(
      (item) => item.grupo === 'atrasada',
    ).length;

    // Ids que precisam virar nome — resolvidos fora da transação por quem
    // chama (ver aplicarNomes).
    const userIds = [
      ...new Set([
        ...ordenadas.map((o) => o.ownerUserId),
        ...fixadasRaw.map((c) => c.authorUserId),
        ...tarefasRaw.map((t) => t.assigneeUserId),
      ]),
    ];

    return {
      dataExtenso: dataExtensoBR(agora, tz),
      diaCurto: diaCurtoBR(agora, tz),
      diaSemana: diaSemanaBR(agora, tz),
      totalEmAberto,
      totalOportunidades: ordenadas.length,
      semValorDefinido,
      etapas,
      pipeline,
      fixadas,
      tarefas,
      totalTarefasPendentes: tarefasRaw.length,
      tarefasNoRecorte: noRecorte.length,
      tarefasRecorteAte: diaComSemanaCurto(fimDaProxima),
      tarefasAtrasadas,
      userIds,
    };
  }

  // Uma linha da tabela do pipeline. Mesma montagem nos dois reports — o
  // que muda entre eles é o recorte e a ordem, nunca o conteúdo da linha.
  private linhaDe(
    opp: OportunidadeParaLinha,
    nr: number,
    agora: Date,
    tz: string,
  ): LinhaPipeline {
    const valor = Number(opp.amount);
    return {
      nr,
      abertura: diaCurtoBR(opp.createdAt, tz),
      fechamentoPrevisto: opp.expectedCloseDate
        ? diaCurtoBR(opp.expectedCloseDate, tz)
        : null,
      empresa: nomeEmpresa(opp.company),
      representante: opp.ownerUserId,
      etapa: opp.stage.name,
      etapaOrdem: opp.stage.order,
      // Selo igual ao do quadro (2026-09-16): SLA automático, ver
      // opportunities/opportunity-sla.ts.
      slaDias: diasDeSla(opp, agora, tz),
      itens: opp.items.map((i) => i.name),
      // Oportunidade sem valor preenchido aparece como "a definir" no
      // e-mail, nunca como R$ 0 — os dois significam coisas diferentes
      // pra quem lê.
      valor: valor > 0 ? valor : null,
    };
  }

  // Follow-up das cotações (2026-09-15): só as oportunidades abertas das
  // etapas de proposta, quatro vezes por dia útil. O objetivo é outro do
  // resumo diário — ali é panorama, aqui é fila de trabalho. A ordem é a
  // do quadro, igual ao resumo.
  async coletarFollowup(
    tx: TenantTx,
    workspaceId: string,
    etapasAlvo: string[],
    agora: Date = new Date(),
  ): Promise<{
    dados: Omit<DadosFollowup, 'appUrl'>;
    userIds: string[];
    etapasEncontradas: string[];
  }> {
    const tz = this.tz;
    const alvo = new Set(etapasAlvo.map(chaveEtapa));

    const oportunidades = await tx.opportunity.findMany({
      where: { workspaceId, deletedAt: null, status: 'open' },
      include: {
        company: { select: COMPANY_REF_SELECT },
        stage: { select: { name: true, order: true } },
        items: {
          select: { name: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    // Etapa casada pelo NOME, sem diferenciar maiúscula nem acento —
    // renomear "Aprovação de Propostas" pra "Aprovacao de propostas" não
    // pode esvaziar o report em silêncio.
    const daEtapa = oportunidades.filter((opp) =>
      alvo.has(chaveEtapa(opp.stage.name)),
    );
    const etapasEncontradas = [
      ...new Set(daEtapa.map((opp) => opp.stage.name)),
    ];

    // Mesma ordem do quadro (pedido do usuário, 2026-09-16): quem gerencia
    // a prioridade é o arrasto no Pipeline, e o e-mail só espelha.
    const ordenadas = [...daEtapa].sort(ordemDoQuadro);

    const pipeline: LinhaPipeline[] = ordenadas
      .slice(0, MAX_LINHAS_PIPELINE)
      .map((opp, indice) => this.linhaDe(opp, indice + 1, agora, tz));

    return {
      dados: {
        dataExtenso: dataExtensoBR(agora, tz),
        diaCurto: diaCurtoBR(agora, tz),
        horario: horarioBR(agora, tz),
        etapasAcompanhadas: etapasAlvo,
        totalEmAberto: ordenadas.reduce(
          (soma, opp) => soma + Number(opp.amount),
          0,
        ),
        totalOportunidades: ordenadas.length,
        semValorDefinido: ordenadas.filter((opp) => Number(opp.amount) <= 0)
          .length,
        // "A mais antiga": maior SLA da lista, mesma conta do selo.
        maiorSla: ordenadas.reduce(
          (maior, opp) => Math.max(maior, diasDeSla(opp, agora, tz)),
          0,
        ),
        pipeline,
      },
      userIds: [...new Set(ordenadas.map((o) => o.ownerUserId))],
      etapasEncontradas,
    };
  }

  // Quem recebe o resumo (decisão do usuário, 2026-09-15): todo membro
  // ATIVO do workspace, exceto representante — e todos recebem o mesmo
  // conteúdo, o quadro inteiro da empresa ("gerente para cima recebe
  // todos"). Papel `readonly` entra: a regra é excluir representante, não
  // incluir só gerência.
  //
  // Devolve user_ids; o e-mail de cada um vem de emailsDe(), fora da
  // transação.
  // `somente`: lista escolhida na tela para ESTE report. Vazia (o padrão)
  // = todos os elegíveis. A interseção com a consulta importa: alguém que
  // virou representante ou foi inativado depois de ser escolhido para de
  // receber sozinho, sem precisar editar a lista.
  async membrosElegiveis(
    tx: TenantTx,
    workspaceId: string,
    somente: string[] = [],
  ): Promise<string[]> {
    const membros = await tx.membership.findMany({
      where: {
        workspaceId,
        status: 'active',
        role: { not: 'sales_rep' },
        ...(somente.length > 0 ? { userId: { in: somente } } : {}),
      },
      select: { userId: true },
    });
    return [...new Set(membros.map((m) => m.userId))];
  }

  // Converte user_ids em endereços de e-mail. O e-mail de CONTATO do
  // membro mora em user_metadata.email no Supabase Auth (campo "E-mail" da
  // tela de Membros) — NÃO confundir com o login, que é um endereço
  // sintético @login.gamabrasil.com.br sem caixa de entrada nenhuma. Quem
  // não tem contato preenchido volta em `semEmail`, pra que a ausência
  // vire aviso no log em vez de silêncio.
  async emailsDe(
    userIds: string[],
  ): Promise<{ emails: string[]; semEmail: string[] }> {
    const fixos = this.config.get<string[]>('reportTo') ?? [];
    if (fixos.length > 0) {
      // Válvula de escape (REPORT_TO): quando definida, manda pra lista
      // fixa e ignora o CRM — existe pra teste e pra incluir alguém que
      // não é membro.
      return { emails: fixos, semEmail: [] };
    }

    const identidades = await this.supabaseUsers.getIdentities(userIds);
    const emails: string[] = [];
    const semEmail: string[] = [];
    for (const userId of userIds) {
      const email = identidades.get(userId)?.email?.trim();
      if (email && email.includes('@')) emails.push(email);
      else semEmail.push(userId);
    }
    return { emails: [...new Set(emails)], semEmail };
  }

  // Quem receberia o report agora, com nome e e-mail — a tela "E-mail
  // automático" mostra a lista pra que "não recebi" tenha resposta óbvia
  // (o membro está sem e-mail cadastrado). Fora de transação: é chamada de
  // rede ao Supabase Auth.
  async destinatariosDetalhados(
    userIds: string[],
  ): Promise<{ userId: string; nome: string; email: string | null }[]> {
    const identidades = await this.supabaseUsers.getIdentities(userIds);
    return userIds
      .map((userId) => {
        const identidade = identidades.get(userId);
        if (!identidade) return null;
        return {
          userId,
          nome: identidade.name?.trim() || identidade.login,
          email: identidade.email?.trim() || null,
        };
      })
      .filter(
        (d): d is { userId: string; nome: string; email: string | null } =>
          d !== null,
      )
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  // Troca os ids de usuário pelos nomes de exibição. Chamado FORA da
  // transação (ver comentário em coletarDiario). Id que não resolve fica
  // como "—" em vez de aparecer cru no e-mail: o id não diz nada pra quem
  // lê, e já foi um bug real na tela do Pipeline (2026-09-11).
  async aplicarNomes<
    T extends {
      pipeline: LinhaPipeline[];
      fixadas: AnotacaoFixada[];
      tarefas: TarefaPendente[];
      userIds: string[];
    },
  >(dados: T): Promise<void> {
    const identidades = await this.supabaseUsers.getIdentities(dados.userIds);
    const nome = (id: string): string => {
      const identidade = identidades.get(id);
      return identidade?.name?.trim() || identidade?.login?.trim() || '—';
    };
    const ehUuid = (valor: string) => dados.userIds.includes(valor);

    for (const linha of dados.pipeline) {
      linha.representante = nome(linha.representante);
    }
    for (const fixada of dados.fixadas) {
      // externalAuthor já é nome de gente; só troca o que ainda é id.
      if (ehUuid(fixada.autor)) fixada.autor = nome(fixada.autor);
    }
    for (const tarefa of dados.tarefas) {
      tarefa.responsavel = nome(tarefa.responsavel);
    }
  }
}

// Ordem em que o quadro do Pipeline mostra os cards: etapa da esquerda
// pra direita; dentro da etapa, a posição arrastada à mão e, pra quem nunca
// foi arrastado, o mais recente primeiro — igual a OpportunityService#findAll.
function ordemDoQuadro(
  a: { stage: { order: number }; position: number | null; createdAt: Date },
  b: { stage: { order: number }; position: number | null; createdAt: Date },
): number {
  if (a.stage.order !== b.stage.order) return a.stage.order - b.stage.order;
  if (a.position !== b.position) {
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  }
  return b.createdAt.getTime() - a.createdAt.getTime();
}

// Nome de etapa sem acento e sem diferença de maiúscula — é assim que a
// lista configurada casa com o que está gravado no banco.
function chaveEtapa(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// Forma mínima de oportunidade que `linhaDe` consome — evita repetir o
// tipo gerado pelo Prisma (com include) nas duas consultas.
interface OportunidadeParaLinha {
  amount: unknown;
  createdAt: Date;
  expectedCloseDate: Date | null;
  slaDueDate: Date | null;
  slaRevisionDate: Date | null;
  ownerUserId: string;
  company: CompanyRef | null;
  stage: { name: string; order: number };
  items: { name: string }[];
}
