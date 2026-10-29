import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listRecentActivities } from "@/lib/api/activities";
import { companyDisplayName, companyRazaoSocialName } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listMemberships } from "@/lib/api/memberships";
import { listPipelines } from "@/lib/api/pipelines";
import { ETAPA_LABEL, listRawLeads } from "@/lib/api/raw-leads";
import { listTasks, taskTypeLabel } from "@/lib/api/tasks";
import type {
  Activity,
  Membership,
  Opportunity,
  RawLead,
  RawLeadEtapa,
  Task,
} from "@/lib/api/types";
import { dayKeyBR } from "@/lib/format-date";
import RecentActivityTable from "./recent-activity-table";
import WeeklyTasksTable from "./weekly-tasks-table";
import TopbarFilter from "@/app/_components/topbar-filter";

function brl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Fim da semana corrente (domingo 23:59:59) — "Ações da semana" mostra
// tudo que vence até lá; não precisa de início de semana separado
// porque atrasadas de qualquer data no passado também devem aparecer
// (pedido do usuário, 2026-08-05).
function endOfWeek(): Date {
  const d = new Date();
  const day = d.getDay(); // 0=dom .. 6=sáb
  d.setDate(d.getDate() + (day === 0 ? 0 : 7 - day));
  d.setHours(23, 59, 59, 999);
  return d;
}

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// Mesmas chaves de empresas/_ficha/ficha-body.tsx e leads/_ficha/
// ficha-body.tsx (protótipo: DB.interactionTypes) — registro manual de
// contato feito pela aba Timeline.
const SUBTIPO_LABEL: Record<string, string> = {
  nota: "Anotação",
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
};

// Nome de exibição do usuário — mesmo padrão de tarefas/_detail/
// detail-body.tsx e pipeline/_detail/detail-body.tsx (GET /memberships
// vem enriquecido com nome/login real via Supabase Auth Admin API).
function memberDisplayName(userId: string, memberships: Membership[]): string {
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || `${userId.slice(0, 8)}…`;
}

const ETAPAS_PROPOSTA = new Set([
  "Solicitação de Propostas",
  "Elaboração de Propostas",
  "Aprovação de Propostas",
]);

// A anotação que o lead do Meta gera traz a origem completa (plataforma,
// formulário, campanha, anúncio) mais uma linha por pergunta respondida —
// texto longo demais pra uma lista de leitura rápida. Aqui fica só a origem
// enxuta; o conteúdo inteiro continua na Timeline da ficha.
const META_PREFIXO = "Lead do formulário do Meta";

function resumirRegistro(texto: string): string {
  const primeiraLinha = texto.split("\n")[0].trim();
  if (!primeiraLinha.startsWith(META_PREFIXO)) {
    return primeiraLinha.length > 120 ? `${primeiraLinha.slice(0, 119)}…` : primeiraLinha;
  }
  const dentro = primeiraLinha.match(/\(([^)]*)\)/)?.[1] ?? "";
  const partes = dentro
    .split(" · ")
    .map((parte) => parte.replace(/\s*"[^"]*"$/, "").trim())
    .filter((parte) => parte.startsWith("via ") || parte === "formulário");
  return partes.length > 0 ? `${META_PREFIXO} (${partes.join(" · ")})` : META_PREFIXO;
}

interface DescribedActivity {
  id: string;
  kind: string;
  text: string;
  company: string | null;
  occurredAt: string;
  href: string;
}

// "Últimas atividades" (fora do SPEC-CRM-GAMA.md original) — um único
// feed misturando os 5 tipos de evento que o usuário pediu: registro
// manual de contato (ligação/reunião/visita/e-mail/nota), tarefa
// (criada/concluída), oportunidade (criada/fechada/etc.), cadastro de
// empresa e prospecção aprovada (RawLeadService#approve, que passou a
// emitir uma Activity só pra alimentar este feed). `Activity.payload` é
// json solto — o formato exato de cada combinação type+payload.action
// espelha exatamente o que os *.service.ts do backend emitem hoje (ver
// activities.emit em company/opportunity/task/raw-lead). `href` (pedido
// do usuário, 2026-08-05) manda a linha pro registro de origem — tarefa
// só tem link porque TaskService passou a incluir `taskId` no payload
// (antes só tinha `title`, sem id nenhum pra apontar de volta).
function describeActivity(
  activity: Activity,
  opportunities: Opportunity[],
): DescribedActivity {
  const payload = activity.payload;
  const companyId =
    activity.companyId ??
    (activity.opportunityId
      ? (opportunities.find((o) => o.id === activity.opportunityId)?.companyId ?? null)
      : null);
  // Empresa vem embutida em GET /activities (direta ou a da oportunidade).
  const company = activity.company ?? activity.opportunity?.company ?? null;
  const companyLabel = company ? companyDisplayName(company) : null;
  const companyHref = companyId ? `/dashboard/empresas/${companyId}` : null;
  const opportunityHref = activity.opportunityId ? `/dashboard/pipeline/${activity.opportunityId}` : null;
  // Registro manual (Timeline) pode estar preso a uma empresa OU a uma
  // oportunidade (createManual aceita os dois) — prioriza empresa (é o
  // caminho mais comum), cai pra oportunidade quando não tem.
  const entityHref = companyHref ?? opportunityHref ?? "/dashboard";

  if (activity.type === "note" || activity.type === "call" || activity.type === "email") {
    const subtipo =
      (payload.subtipo as string | undefined) ??
      (activity.type === "call" ? "ligacao" : activity.type === "email" ? "email" : "nota");
    return {
      id: activity.id,
      kind: SUBTIPO_LABEL[subtipo] ?? "Registro",
      text: resumirRegistro((payload.texto as string | undefined) ?? "Contato registrado"),
      company: companyLabel,
      occurredAt: activity.occurredAt,
      href: entityHref,
    };
  }

  // Do Pipeline o feed só traz quatro eventos (filtro no backend,
  // ActivityQueryService, 2026-09-17): criada, movida para Negociação,
  // volta de Negociação — que o usuário quer ler como "solicitada
  // alteração" — e fechada/perdida.
  if (activity.type === "stage_change") {
    const voltou = ETAPAS_PROPOSTA.has(String(payload.toStageName ?? ""));
    return {
      id: activity.id,
      kind: "Oportunidade",
      text: voltou
        ? "Solicitada alteração"
        : `Movida para ${(payload.toStageName as string | undefined) ?? "Negociação e Fechamento"}`,
      company: companyLabel,
      occurredAt: activity.occurredAt,
      href: opportunityHref ?? "/dashboard/pipeline",
    };
  }

  const action = payload.action as string | undefined;

  if (action === "lead_approved") {
    const razaoSocial = payload.razaoSocial as string | undefined;
    return {
      id: activity.id,
      kind: "Prospecção",
      text: `Lead aprovado${razaoSocial ? ` — ${razaoSocial}` : ""}`,
      company: companyLabel,
      occurredAt: activity.occurredAt,
      href: companyHref ?? "/dashboard/leads",
    };
  }

  if (action === "lead_unconverted") {
    const razaoSocial = payload.razaoSocial as string | undefined;
    return {
      id: activity.id,
      kind: "Prospecção",
      text: `Lead desconvertido${razaoSocial ? ` — ${razaoSocial}` : ""}`,
      company: companyLabel,
      occurredAt: activity.occurredAt,
      href: companyHref ?? "/dashboard/leads",
    };
  }

  if (typeof payload.title === "string") {
    const taskId = payload.taskId as string | undefined;
    return {
      id: activity.id,
      kind: "Tarefa",
      text: action === "completed" ? `Concluiu "${payload.title}"` : `Criou a tarefa "${payload.title}"`,
      company: companyLabel,
      occurredAt: activity.occurredAt,
      href: taskId ? `/dashboard/tarefas/${taskId}` : "/dashboard/tarefas",
    };
  }

  if (activity.opportunityId) {
    const text =
      action === "created"
        ? "Oportunidade criada"
        : action === "status_changed"
          ? payload.to === "won"
            ? "Marcada como fechada"
            : payload.to === "lost"
              ? `Marcada como perdida${payload.lostReason ? ` — ${payload.lostReason}` : ""}`
              : "Mudou status"
          : action === "deleted"
            ? "Oportunidade arquivada"
            : action === "restored"
              ? "Oportunidade restaurada"
              : "Oportunidade atualizada";
    return {
      id: activity.id,
      kind: "Oportunidade",
      text,
      company: companyLabel,
      occurredAt: activity.occurredAt,
      href: opportunityHref ?? "/dashboard/pipeline",
    };
  }

  const text =
    action === "created"
      ? "Cadastro de empresa"
      : action === "deleted"
        ? "Empresa arquivada"
        : action === "restored"
          ? "Empresa restaurada"
          : "Dados atualizados";
  return {
    id: activity.id,
    kind: "Empresa",
    text,
    company: companyLabel,
    occurredAt: activity.occurredAt,
    href: companyHref ?? "/dashboard/empresas",
  };
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const zone = "America/Sao_Paulo";
  if (dayKeyBR(d) === dayKeyBR(now)) {
    return `hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: zone })}`;
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: zone });
}

// Painel comercial (SPEC-CRM-GAMA.md §4.5) — tudo derivado das mesmas
// listagens que Pipeline/Tarefas/Leads já usam (+ /activities sem
// filtro, ver ActivityQueryService#findAll, pro card "Últimas
// atividades"), sem endpoint novo dedicado a este painel.
// Janelas de tempo do funil. Semana e 1 mês entraram em 2026-10-13 (o CRM
// só tem dados desde ago/2026, então as janelas longas mostravam todas o
// mesmo número); 12 meses virou 6 meses no mesmo pedido. "tudo" existe pra
// conferência, não pra leitura do dia.
const JANELAS = [
  { chave: "semana", label: "Semana" },
  { chave: "1m", label: "1 mês" },
  { chave: "3m", label: "3 meses" },
  { chave: "6m", label: "6 meses" },
  { chave: "ano", label: "Este ano" },
  { chave: "tudo", label: "Tudo" },
] as const;
type Janela = (typeof JANELAS)[number]["chave"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ janela?: string }>;
}) {
  const { janela: janelaParam } = await searchParams;
  const janela: Janela = JANELAS.some((j) => j.chave === janelaParam)
    ? (janelaParam as Janela)
    : "6m";
  const token = await getServerAccessToken();
  const [
    { items: pipelines },
    { items: opportunities },
    { items: tasks },
    { items: leadsNovos },
    memberships,
    { items: leadsAprovados },
    { items: leadsDescartadosItems },
  ] = await Promise.all([
    listPipelines(token),
    listOpportunities(token),
    listTasks(token),
    listRawLeads(token, { status: "novo" }),
    listMemberships(token),
    // As linhas dos convertidos, não só o total (2026-09-18): o funil
    // precisa saber quais deles passaram pela qualificação do SDR e a
    // qual empresa cada um virou, pra casar com as propostas do Pipeline.
    listRawLeads(token, { status: "aprovado" }),
    // Também as linhas (2026-09-21): o funil por período precisa da data
    // do descarte, não só de quantos foram descartados no total.
    listRawLeads(token, { status: "descartado" }),
  ]);

  // Isolado do Promise.all acima de propósito: é a chamada mais nova
  // desta tela, e uma falha nela (ex.: descompasso momentâneo entre
  // deploy do frontend e do backend) não pode derrubar o painel inteiro
  // — degrada pra "sem atividades recentes" em vez de erro 500 na
  // página toda.
  const recentActivities = await listRecentActivities(token, { pageSize: 12 }).then(
    (r) => r.items,
    () => [],
  );

  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

  const abertas = opportunities.filter((o) => o.status === "open" && !o.deletedAt);
  const totalAberto = abertas.reduce((s, o) => s + Number(o.amount), 0);
  // Ticket médio das propostas em aberto (2026-09-21, substituiu a
  // "previsão ponderada" — valor × probabilidade da etapa: com todas as
  // propostas na última etapa, ela era só 80% do pipeline, não informava
  // nada). Só entram na média as que TÊM valor informado: proposta com
  // R$ 0 é campo em branco, não negócio de zero real, e derrubaria a
  // média pela metade.
  const abertasComValor = abertas.filter((o) => Number(o.amount) > 0);
  const ticketMedio =
    abertasComValor.length > 0
      ? abertasComValor.reduce((s, o) => s + Number(o.amount), 0) / abertasComValor.length
      : 0;

  const mesInicio = startOfMonth();
  const ganhasNoMes = opportunities.filter(
    (o) => o.status === "won" && o.closedAt && new Date(o.closedAt) >= mesInicio,
  );
  const ganhoNoMes = ganhasNoMes.reduce((s, o) => s + Number(o.amount), 0);

  const hojeInicio = startOfToday();
  const semanaFim = endOfWeek();
  const tarefasSemana = tasks
    .filter((t) => t.status === "pending" && t.dueAt !== null && new Date(t.dueAt) <= semanaFim)
    .sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string));

  // Coluna "Empresa" de Ações da semana mostra razão social (pedido do
  // usuário, 2026-08-11). A empresa vem embutida em GET /tasks desde
  // 2026-09-04 (direta ou a da oportunidade, inclusive arquivada ou ainda
  // em triagem de lead) — o Painel parou de baixar a base inteira de
  // empresas pra rotular meia dúzia de linhas.
  const targetLabel = (task: Task) => {
    const company = task.company ?? task.opportunity?.company ?? null;
    return company ? companyRazaoSocialName(company) : "—";
  };
  const dueInfo = (task: Task): { cls: string; label: string } => {
    if (!task.dueAt) return { cls: "due-ok", label: "—" };
    const due = new Date(task.dueAt);
    due.setHours(0, 0, 0, 0);
    if (due < hojeInicio) return { cls: "due-late", label: "atrasada" };
    if (due.getTime() === hojeInicio.getTime()) return { cls: "due-today", label: "hoje" };
    return { cls: "due-ok", label: WEEKDAY_SHORT[due.getDay()] };
  };

  // ── Funil de vendas (2026-09-18) ────────────────────────────────────────
  // Substituiu o resumo por etapa do Pipeline (uma barra por stage, que só
  // olhava as oportunidades abertas). Agora são as quatro faixas da jornada
  // do lead (decisões 6.1/6.2/6.6): o funil começa na Prospecção e termina
  // no resultado da negociação, no formato que o usuário aprovou.
  //
  // "Avançou" é sempre quem passou pra faixa seguinte, "ficou" quem está
  // parado ali e "perdeu" quem saiu do funil naquele ponto.
  //
  // CORREÇÃO 2026-09-18 (o usuário leu "26" na faixa Leads Qualificados
  // sem ter um único lead qualificado na base, e 124 negócios fechados
  // saindo de 26 leads convertidos). Duas causas, as duas tratadas aqui:
  //
  //  1. A carga das cotações de jul-set/2025 nunca passou pela jornada do
  //     lead — entrou direto como histórico. Fica FORA do funil
  //     (opportunity.origem = 'historico-cotacoes'); segue inteira no
  //     Pipeline e nos relatórios.
  //  2. O funil creditava todo lead convertido como "passou pela
  //     qualificação". Não passou: quem nunca teve prazo registrado
  //     entrou pelo caminho da oportunidade pronta (decisão 6.1), e é
  //     isso que a tela diz agora.
  const leadsConvertidos = leadsAprovados.length;

  // Só o ciclo corrente. Uma carga histórica futura (ou o app de
  // orçamentos, na fase 2) é marcada em origem e cai fora daqui sozinha.
  const oppCiclo = opportunities.filter((o) => !o.deletedAt && !o.origem);
  const abertasCiclo = oppCiclo.filter((o) => o.status === "open");
  const valorAbertoCiclo = abertasCiclo.reduce((s, o) => s + Number(o.amount), 0);

  // Empresa que veio de lead convertido × empresa que chegou com a
  // oportunidade pronta (recompra/indicação). O lead guarda a empresa que
  // ele virou em promotedCompanyId.
  const empresasDeLead = new Set(
    leadsAprovados.map((l) => l.promotedCompanyId).filter((id): id is string => Boolean(id)),
  );
  const propostasDiretas = oppCiclo.filter((o) => !empresasDeLead.has(o.companyId)).length;
  const historicas = opportunities.filter((o) => !o.deletedAt && Boolean(o.origem));

  // Situação de cada lead convertido, olhando SÓ proposta do ciclo
  // corrente (2026-09-21, pedido do usuário: "os leads convertidos estão
  // herdando a importação ainda, retratar somente registros do CRM").
  // Cotação histórica não conta como negociação viva — quem só tem
  // cotação de 2025 entra em "sem proposta cadastrada", que é a verdade.
  const cicloPorEmpresa = new Map<string, { aberta: boolean; fechada: boolean }>();
  for (const o of oppCiclo) {
    const atual = cicloPorEmpresa.get(o.companyId) ?? { aberta: false, fechada: false };
    if (o.status === "open") atual.aberta = true;
    else atual.fechada = true;
    cicloPorEmpresa.set(o.companyId, atual);
  }
  let convertidosComResultado = 0;
  let convertidosEmNegociacao = 0;
  for (const lead of leadsAprovados) {
    const ciclo = lead.promotedCompanyId ? cicloPorEmpresa.get(lead.promotedCompanyId) : undefined;
    if (ciclo?.fechada) convertidosComResultado += 1;
    else if (ciclo?.aberta) convertidosEmNegociacao += 1;
  }
  const convertidosSemProposta = leadsConvertidos - convertidosComResultado - convertidosEmNegociacao;

  // ── Janela de tempo do funil (2026-09-21) ───────────────────────────────
  // O usuário pegou o furo: "o funil não deveria refletir dados sob a
  // ótica de um período? senão ano que vem os dados estarão acumulados".
  // Estava certo — o funil contava ESTOQUE de todos os tempos e a taxa de
  // conversão dividia ganhos pelo total de leads, caindo sozinha a cada
  // lead importado.
  //
  // Agora cada faixa mostra três coisas diferentes, que não se misturam:
  //   1. quantos estão na faixa AGORA (foto, sem período — é o estoque);
  //   2. o MOVIMENTO dentro da janela (entrou / avançou / saiu);
  //   3. a PENDÊNCIA da faixa, com link pra tela já filtrada.
  //
  // Janela padrão de 6 meses (era 12 até 2026-10-13, pedido do usuário).
  const inicioJanela = (() => {
    const d = new Date();
    if (janela === "tudo") return null;
    if (janela === "ano") return new Date(d.getFullYear(), 0, 1);
    if (janela === "semana") d.setDate(d.getDate() - 7);
    else if (janela === "1m") d.setMonth(d.getMonth() - 1);
    else if (janela === "3m") d.setMonth(d.getMonth() - 3);
    else d.setMonth(d.getMonth() - 6);
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const naJanela = (iso: string | null | undefined) => {
    if (!iso) return false;
    if (!inicioJanela) return true;
    return new Date(iso) >= inicioJanela;
  };

  const todosLeads = [...leadsNovos, ...leadsAprovados, ...leadsDescartadosItems];
  const convertidosNaJanela = leadsAprovados.filter((l) => naJanela(l.convertedAt)).length;

  // ── Movimento de cada faixa da prospecção (2026-10-21) ──────────────────
  // O usuário leu "1.347 entraram, 585 saíram, 0,0% avançou" em
  // Prospectar/Entrada com 917 empresas em Andamento: as faixas do meio
  // não tinham data de passagem, então ninguém avançava, e todo descarte
  // caía na primeira faixa. Agora cada faixa conta o próprio movimento.
  const ORDEM_FAIXAS: RawLeadEtapa[] = ["entrada", "andamento", "reuniao", "qualificado", "negociacao"];
  const posicao = (l: RawLead) => ORDEM_FAIXAS.indexOf(l.etapa);
  const ms = (iso: string) => new Date(iso).getTime();
  const datasGravadas = (l: RawLead) => [
    l.createdAt,
    l.andamentoAt,
    l.reuniaoAt,
    l.qualifiedAt,
    l.convertedAt,
  ];
  // Quando o lead entrou na faixa. Sem data gravada (passagem anterior a
  // 2026-10-21 sem registro na Timeline), a faixa em que ele está — ou
  // parou, se descartado — usa a data de criação: ele com certeza passou
  // por ali depois de criado, então a passagem só conta quando o lead
  // inteiro é do período, e lead antigo nunca ganha movimento inventado.
  // Negociação fica fora dessa regra: conversão sem data segue fora do
  // movimento (linha própria embaixo do funil).
  const entrouNaFaixa = (l: RawLead, faixa: number): string | null =>
    datasGravadas(l)[faixa] ?? (faixa < 4 && posicao(l) === faixa ? l.createdAt : null);
  // Quando saiu da faixa pra frente: a primeira faixa seguinte em que
  // entrou depois dela. Quem pulou a faixa (arrastou de Prospectar direto
  // pra Reunião, converteu sem prazo) não avançou de onde nunca esteve —
  // é a decisão 6.10, que já valia pra Qualificado ("3400% avançou",
  // 2026-10-13, era todo convertido contado como qualificado).
  const saiuPraFrente = (l: RawLead, faixa: number): string | null => {
    const desde = entrouNaFaixa(l, faixa);
    if (!desde) return null;
    const seguintes = datasGravadas(l)
      .slice(faixa + 1)
      .filter((d): d is string => d !== null && ms(d) >= ms(desde));
    if (seguintes.length > 0) return seguintes.reduce((a, b) => (ms(a) <= ms(b) ? a : b));
    // Está numa faixa à frente sem data gravada dela: mesma regra da
    // criação de entrouNaFaixa.
    const pos = posicao(l);
    return pos > faixa && pos < 4 ? l.createdAt : null;
  };
  const movimentoDaFaixa = (faixa: number) => ({
    entrou: todosLeads.filter((l) => naJanela(entrouNaFaixa(l, faixa))).length,
    avancou: todosLeads.filter((l) => naJanela(saiuPraFrente(l, faixa))).length,
    // O descartado guarda a etapa em que parou: é dali que ele saiu.
    saiu: leadsDescartadosItems.filter((l) => naJanela(l.discardedAt) && posicao(l) === faixa)
      .length,
  });
  // Conversões feitas antes de 2026-09-21, quando as datas passaram a ser
  // gravadas. Ficam fora do movimento de propósito — inventar data
  // falsearia a série. Aparecem numa linha só, embaixo do funil.
  const convertidosSemData = leadsAprovados.filter((l) => !l.convertedAt).length;

  const fechadasNaJanela = oppCiclo.filter(
    (o) => o.status !== "open" && naJanela(o.closedAt ?? o.createdAt),
  );
  const ganhasNaJanela = fechadasNaJanela.filter((o) => o.status === "won");
  const perdidasNaJanela = fechadasNaJanela.filter((o) => o.status === "lost");
  const valorGanhoJanela = ganhasNaJanela.reduce((s, o) => s + Number(o.amount), 0);
  const valorPerdidoJanela = perdidasNaJanela.reduce((s, o) => s + Number(o.amount), 0);
  // Win rate: ganhas sobre o que FECHOU na janela. É a métrica que não se
  // degrada com o crescimento da base (a antiga dividia pelo total de
  // leads de todos os tempos e tendia a zero).
  const winRate =
    fechadasNaJanela.length > 0 ? (ganhasNaJanela.length / fechadasNaJanela.length) * 100 : null;

  // Pendências: o que fazer olhando cada faixa. É o que faltava pro funil
  // "direcionar para alguma linha de ação" (pedido do usuário, 2026-09-21:
  // "olhando para ele como está não sei o que fazer").
  const propostasSemValor = abertasCiclo.filter((o) => Number(o.amount) === 0).length;
  const propostasSemPrazo = abertasCiclo.filter((o) => !o.expectedCloseDate).length;

  // ── As cinco etapas do funil (2026-09-23) ───────────────────────────────
  // Pedido do usuário: "reestruturar as etapas do funil — Prospectar/
  // Entrada > Andamento > Reunião > Qualificado > Negociação/Fechamento".
  //
  // O estoque de cada faixa agora vem da COLUNA `etapa` do lead (a mesma
  // que o quadro Kanban da Prospecção move), não de uma derivação de
  // status + prazo. É o que permitiu existirem as duas faixas do meio —
  // "já falei com a empresa" e "tem reunião marcada" —, que a régua antiga
  // não sabia representar.
  //
  // O MOVIMENTO no período sai das datas de passagem de cada faixa
  // (movimentoDaFaixa acima); as pastilhas de movimento não são
  // desenhadas quando zeradas.
  const emTriagemPorEtapa = (etapa: RawLeadEtapa) =>
    leadsNovos.filter((l) => l.etapa === etapa).length;

  const faixas = [
    {
      nome: ETAPA_LABEL.entrada,
      detalhe: "Empresas na fila, ainda sem nenhum contato registrado",
      agora: emTriagemPorEtapa("entrada"),
      ...movimentoDaFaixa(0),
      valor: null as number | null,
      acao:
        emTriagemPorEtapa("entrada") > 0
          ? {
              texto: `${emTriagemPorEtapa("entrada").toLocaleString("pt-BR")} esperando a primeira abordagem`,
              href: "/dashboard/leads?tier=prospects",
              rotulo: "Abrir fila",
            }
          : null,
    },
    {
      nome: ETAPA_LABEL.andamento,
      detalhe: "SDR já registrou contato, sem reunião marcada",
      agora: emTriagemPorEtapa("andamento"),
      ...movimentoDaFaixa(1),
      valor: null as number | null,
      acao: null,
    },
    {
      nome: ETAPA_LABEL.reuniao,
      detalhe: "Reunião marcada ou realizada com o cliente",
      agora: emTriagemPorEtapa("reuniao"),
      ...movimentoDaFaixa(2),
      valor: null as number | null,
      acao: null,
    },
    {
      nome: ETAPA_LABEL.qualificado,
      detalhe: "Prazo de investimento informado ao SDR",
      agora: emTriagemPorEtapa("qualificado"),
      ...movimentoDaFaixa(3),
      valor: null as number | null,
      acao:
        emTriagemPorEtapa("qualificado") > 0
          ? {
              texto: `${emTriagemPorEtapa("qualificado")} qualificados esperando proposta`,
              href: "/dashboard/leads?tier=qualificados",
              rotulo: "Abrir qualificados",
            }
          : null,
    },
    {
      nome: ETAPA_LABEL.negociacao,
      detalhe: "Lead convertido: proposta em negociação e resultado do período",
      agora: abertasCiclo.length,
      entrou: convertidosNaJanela,
      avancou: ganhasNaJanela.length,
      saiu: perdidasNaJanela.length,
      valor: valorAbertoCiclo,
      acao:
        convertidosSemProposta > 0
          ? {
              texto: `${convertidosSemProposta} convertidos sem proposta cadastrada`,
              href: "/dashboard/leads-convertidos",
              rotulo: "Abrir convertidos",
            }
          : propostasSemValor + propostasSemPrazo > 0
            ? {
                texto: [
                  propostasSemValor > 0 ? `${propostasSemValor} sem valor` : null,
                  propostasSemPrazo > 0 ? `${propostasSemPrazo} sem previsão de fechamento` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                href: "/dashboard/pipeline",
                rotulo: "Abrir pipeline",
              }
            : null,
    },
  ];
  // Metade da largura (2026-09-18): as faixas estreitam menos que na
  // prévia em tela cheia, senão a última fica sem espaço pras pastilhas.
  // Cinco degraus desde 2026-09-23.
  const LARGURAS_FUNIL = ["100%", "95%", "90%", "85%", "80%"];

  // Gráfico do pipeline, ao lado do funil: uma barra por etapa com o valor
  // em aberto. É a leitura operacional ("onde estão as propostas agora"),
  // complementar ao funil, que é a leitura de jornada.
  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];
  const porEtapa = stages.map((stage) => {
    const deals = abertas.filter((o) => o.stageId === stage.id);
    return { stage, count: deals.length, valor: deals.reduce((s, o) => s + Number(o.amount), 0) };
  });
  const maxEtapaValor = Math.max(...porEtapa.map((f) => f.valor), 1);
  const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
  const janelaLabel = JANELAS.find((j) => j.chave === janela)?.label ?? "6 meses";

  // WeeklyTasksTable/RecentActivityTable são client components (linha
  // inteira clicável) — só dados planos atravessam a fronteira, nada de
  // função (mesmo motivo de tarefas/tarefas-table.tsx).
  const weeklyRows = tarefasSemana.map((task) => {
    const due = dueInfo(task);
    return {
      id: task.id,
      tipoLabel: task.tipo ? taskTypeLabel(task.tipo) : null,
      userLabel: memberDisplayName(task.assigneeUserId, memberships),
      title: task.title,
      target: targetLabel(task),
      dueLabel: due.label,
      dueClass: due.cls,
    };
  });

  const activityRows = recentActivities.map((a) => {
    const described = describeActivity(a, opportunities);
    return {
      id: described.id,
      kind: described.kind,
      userLabel: a.actorUserId ? memberDisplayName(a.actorUserId, memberships) : "—",
      // Tarefa: quem está com ela; o resto, quem fez (2026-10-29).
      responsavelLabel: a.taskAssigneeUserId
        ? memberDisplayName(a.taskAssigneeUserId, memberships)
        : a.actorUserId
          ? memberDisplayName(a.actorUserId, memberships)
          : "—",
      text: described.text,
      company: described.company,
      when: fmtWhen(described.occurredAt),
      href: described.href,
    };
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Painel comercial</div>
          <div className="page-sub">Visão geral da carteira</div>
        </div>
        <TopbarFilter />
      </div>

      <div className="content">
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-label">Pipeline em aberto</div>
            <div className="stat-value">{brl(totalAberto)}</div>
            <div className="kpi-delta up">▲ {abertas.length} oportunidades ativas</div>
          </div>
          <div className="stat-tile blue">
            <div className="stat-label">Ticket médio</div>
            <div className="stat-value">{brl(ticketMedio)}</div>
            <div className={abertasComValor.length < abertas.length ? "kpi-delta down" : "kpi-delta"}>
              {abertasComValor.length === 0
                ? "⚠ nenhuma proposta com valor"
                : abertasComValor.length < abertas.length
                  ? `⚠ média de ${abertasComValor.length} de ${abertas.length} — resto sem valor`
                  : `média de ${abertasComValor.length} proposta(s) em aberto`}
            </div>
          </div>
          <div className="stat-tile green">
            <div className="stat-label">Ganho no mês</div>
            <div className="stat-value">{brl(ganhoNoMes)}</div>
            <div className="kpi-delta up">▲ {ganhasNoMes.length} fechada(s)</div>
          </div>
          <Link href="/dashboard/leads" className="stat-tile purple" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
            <div className="stat-label">Fila de qualificação</div>
            <div className="stat-value">{leadsNovos.length}</div>
            <div className={leadsNovos.length > 0 ? "kpi-delta down" : "kpi-delta"}>
              {leadsNovos.length > 0 ? "⚠ leads a qualificar" : "fila zerada"}
            </div>
          </Link>
        </div>

        <div className="painel-duo">
          <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 4h18l-7 8v6l-4 2v-8z" />
              </svg>
              Funil de vendas
            </div>
            <div className="janela-seletor">
              {JANELAS.map((j) => (
                <Link
                  key={j.chave}
                  href={`/dashboard?janela=${j.chave}`}
                  className={j.chave === janela ? "tag-chip active" : "tag-chip"}
                >
                  {j.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="panel-body">
            <div className="funil-legenda">
              <span className="fchip entrou">Entraram no período</span>
              <span className="fchip ficou">Na faixa hoje</span>
              <span className="fchip avancou">Avançaram</span>
              <span className="fchip perdeu">Saíram</span>
              <span className="fchip valor">Valor em jogo</span>
            </div>

            <div className="funil">
              {faixas.map((faixa, i) => {
                // Taxa de passagem do PERÍODO: de quem entrou na faixa
                // dentro da janela, quanto avançou. Não usa mais o estoque
                // acumulado — era o que fazia a taxa cair sozinha a cada
                // lead importado.
                // Acima de 100% quer dizer que avançou quem entrou ANTES da
                // janela — a taxa não se aplica, mostra "—".
                const taxaBruta = faixa.entrou > 0 ? (faixa.avancou / faixa.entrou) * 100 : null;
                const taxa = taxaBruta !== null && taxaBruta <= 100 ? taxaBruta : null;
                return (
                  <div className="funil-nivel" key={faixa.nome}>
                    <div className="funil-caixa" style={{ width: LARGURAS_FUNIL[i] }}>
                      <div className="funil-nome">
                        {faixa.nome}
                        <small>{faixa.detalhe}</small>
                      </div>
                      <div className="funil-numeros">
                        {/* Pastilha zerada não é desenhada (2026-09-23):
                            "+0 entraram" ao lado do estoque só confunde.
                            "Hoje" sempre aparece — é o estoque da faixa,
                            e zero ali é informação. */}
                        {faixa.entrou > 0 && (
                          <span className="fchip entrou">
                            +{faixa.entrou.toLocaleString("pt-BR")} <small>entraram</small>
                          </span>
                        )}
                        <span className="fchip ficou">
                          {faixa.agora.toLocaleString("pt-BR")} <small>hoje</small>
                        </span>
                        {faixa.avancou > 0 && (
                          <span className="fchip avancou">
                            {faixa.avancou.toLocaleString("pt-BR")} <small>avançaram</small>
                          </span>
                        )}
                        {faixa.saiu > 0 && (
                          <span className="fchip perdeu">
                            {faixa.saiu.toLocaleString("pt-BR")} <small>saíram</small>
                          </span>
                        )}
                        {faixa.valor !== null && faixa.valor > 0 && (
                          <span className="fchip valor">{brl(faixa.valor)}</span>
                        )}
                      </div>
                    </div>
                    {i < faixas.length - 1 && (
                      <div className={taxa !== null && taxa < 25 ? "funil-taxa fraca" : "funil-taxa"}>
                        {taxa !== null ? pct(taxa) : "—"} <span>avançou</span>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="funil-fecho">
                <div className="funil-circulo">
                  <b>{ganhasNaJanela.length}</b>
                  <span>pedidos</span>
                </div>
                <div className="funil-fecho-valor">{brl(valorGanhoJanela)} fechados no período</div>
              </div>
            </div>

            <div className="funil-totais">
              <div>
                <span className="frot conv">Aproveitamento</span>
                <div className="fnum">{winRate !== null ? pct(winRate) : "—"}</div>
              </div>
              <div>
                <span className="frot perd">Perdidas no período</span>
                <div className="fnum perda">{perdidasNaJanela.length}</div>
              </div>
              <div>
                <span className="frot val">Valor perdido</span>
                <div className="fnum perda">{brl(valorPerdidoJanela)}</div>
              </div>
            </div>

            {/* As pendências voltaram pra baixo do funil, em comentário
                (2026-09-22: "eu gostei como estava antes, que tinha um
                comentário abaixo"). Tentei colocá-las dentro de cada
                faixa, com botão, e ficou alto e pesado. */}
            {faixas
              .filter((f) => f.acao !== null)
              .map((f) => (
                <div className="funil-aviso" key={f.nome}>
                  <span>
                    <b>{f.nome}:</b> {f.acao!.texto}.
                  </span>
                  <Link href={f.acao!.href} className="btn btn-sm btn-ghost">
                    {f.acao!.rotulo} →
                  </Link>
                </div>
              ))}

            <p className="sub" style={{ marginTop: 12 }}>
              O número em amarelo é quem está na faixa <b>hoje</b>; o resto é o movimento dos
              últimos <b>{janelaLabel.toLowerCase()}</b>. Aproveitamento = propostas ganhas sobre as
              que fecharam no período. Só o ciclo comercial em andamento: as {historicas.length}{" "}
              cotações de jul a set/2025 importadas ficam no Pipeline e nos relatórios, fora desta
              conta.
              {convertidosSemData > 0 && (
                <>
                  {" "}
                  {convertidosSemData} conversões são anteriores ao registro de datas (set/2026) e
                  não entram no movimento do período.
                </>
              )}
              {propostasDiretas > 0 && (
                <>
                  {" "}
                  {propostasDiretas} proposta(s) vieram de oportunidade pronta do cliente, sem passar
                  pela Prospecção.
                </>
              )}
            </p>
          </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="M18 9l-5 5-3-3-4 4" />
                </svg>
                Pipeline por etapa
              </div>
              <Link href="/dashboard/pipeline" className="btn btn-sm btn-ghost">
                Abrir pipeline →
              </Link>
            </div>
            <div className="panel-body">
              {porEtapa.length === 0 ? (
                <p className="sub">Nenhuma etapa configurada.</p>
              ) : (
                <div className="funnel-bar">
                  {porEtapa.map((f) => (
                    <div className="fbar" key={f.stage.id}>
                      <div className="fbar-label">{f.stage.name}</div>
                      <div className="fbar-track">
                        <div
                          className="fbar-fill"
                          style={{ width: `${Math.max((f.valor / maxEtapaValor) * 100, 3)}%` }}
                        >
                          {f.count} proposta(s)
                        </div>
                      </div>
                      <div className="fbar-val">{brl(f.valor)}</div>
                    </div>
                  ))}
                </div>
              )}
              <p className="sub" style={{ marginTop: 14 }}>
                Propostas em aberto — {abertas.length} no total, {brl(totalAberto)}.
              </p>
            </div>
          </div>
        </div>

        <div className="report-grid">
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                Ações da semana
              </div>
              <Link href="/dashboard/tarefas" className="btn btn-sm btn-ghost">
                Ver todas →
              </Link>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              <WeeklyTasksTable rows={weeklyRows} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20v-6M6 20V10M18 20V4" />
                </svg>
                Últimas atividades
              </div>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              <RecentActivityTable rows={activityRows} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
