import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listRecentActivities } from "@/lib/api/activities";
import {
  buildCompanyLookup,
  companyDisplayName,
  companyRazaoSocialName,
  listCompanies,
} from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listMemberships } from "@/lib/api/memberships";
import { listPipelines } from "@/lib/api/pipelines";
import { listRawLeads } from "@/lib/api/raw-leads";
import { listTasks, taskTypeLabel } from "@/lib/api/tasks";
import type { Activity, Company, Membership, Opportunity, Task } from "@/lib/api/types";
import { dayKeyBR } from "@/lib/format-date";
import RecentActivityTable from "./recent-activity-table";
import WeeklyTasksTable from "./weekly-tasks-table";

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
  companyById: Map<string, Company>,
  opportunities: Opportunity[],
): DescribedActivity {
  const payload = activity.payload;
  const companyId =
    activity.companyId ??
    (activity.opportunityId
      ? (opportunities.find((o) => o.id === activity.opportunityId)?.companyId ?? null)
      : null);
  const company = companyId ? companyById.get(companyId) : undefined;
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
      text: (payload.texto as string | undefined) ?? "Contato registrado",
      company: companyLabel,
      occurredAt: activity.occurredAt,
      href: entityHref,
    };
  }

  if (activity.type === "stage_change") {
    return {
      id: activity.id,
      kind: "Oportunidade",
      text: "Mudou de etapa",
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
            ? "Fechou negócio (ganho)"
            : payload.to === "lost"
              ? "Marcou como perdida"
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
export default async function DashboardPage() {
  const token = await getServerAccessToken();
  const [
    { items: pipelines },
    { items: opportunities },
    { items: tasks },
    { items: companies },
    { items: leadsNovos },
    memberships,
  ] = await Promise.all([
    listPipelines(token),
    listOpportunities(token),
    listTasks(token),
    listCompanies(token, true),
    listRawLeads(token, { status: "novo" }),
    listMemberships(token),
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
  const stageById = new Map((pipeline?.stages ?? []).map((s) => [s.id, s]));

  const abertas = opportunities.filter((o) => o.status === "open" && !o.deletedAt);
  const totalAberto = abertas.reduce((s, o) => s + Number(o.amount), 0);
  const ponderado = abertas.reduce((s, o) => {
    const prob = stageById.get(o.stageId)?.probability ?? 0;
    return s + Number(o.amount) * (prob / 100);
  }, 0);

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

  const oppCompanyId = (opportunityId: string | null) =>
    opportunityId ? (opportunities.find((o) => o.id === opportunityId)?.companyId ?? null) : null;

  // Empresas que as linhas exibidas referenciam mas que `listCompanies`
  // não devolve — as que ainda têm a tag "lead-triagem" (ver
  // buildCompanyLookup). Sem isto, tarefa criada a partir de um lead em
  // triagem aparecia com "Empresa: —" mesmo tendo vínculo, que é
  // exatamente o que o usuário reportou em 2026-08-13. A tela de Tarefas
  // já tinha esse tratamento; o Painel nunca recebeu.
  //
  // Restrito a tarefasSemana + recentActivities (o que de fato é
  // renderizado), não a `tasks` inteiro: cada empresa faltante custa um
  // GET /companies/:id, então a conta tem que ficar presa ao tamanho da
  // tela, não ao tamanho da página da API.
  const companyById = await buildCompanyLookup(token, companies, [
    ...tarefasSemana.flatMap((t) => [t.companyId, oppCompanyId(t.opportunityId)]),
    ...recentActivities.flatMap((a) => [a.companyId, oppCompanyId(a.opportunityId)]),
  ]);

  // Coluna "Empresa" de Ações da semana mostra razão social (pedido do
  // usuário, 2026-08-11) — inclui empresas arquivadas na busca (companies
  // vem com includeDeleted=true) pra não cair no "—" quando a tarefa
  // aponta pra uma empresa já arquivada.
  const companyName = (id: string | null) => {
    const company = id ? companyById.get(id) : undefined;
    return company ? companyRazaoSocialName(company) : "—";
  };
  const targetLabel = (task: Task) => {
    if (task.companyId) return companyName(task.companyId);
    if (task.opportunityId) {
      const opp = opportunities.find((o) => o.id === task.opportunityId);
      return opp ? companyName(opp.companyId) : "—";
    }
    return "—";
  };
  const dueInfo = (task: Task): { cls: string; label: string } => {
    if (!task.dueAt) return { cls: "due-ok", label: "—" };
    const due = new Date(task.dueAt);
    due.setHours(0, 0, 0, 0);
    if (due < hojeInicio) return { cls: "due-late", label: "atrasada" };
    if (due.getTime() === hojeInicio.getTime()) return { cls: "due-today", label: "hoje" };
    return { cls: "due-ok", label: WEEKDAY_SHORT[due.getDay()] };
  };

  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];
  const funil = stages.map((stage) => {
    const deals = abertas.filter((o) => o.stageId === stage.id);
    return { stage, count: deals.length, valor: deals.reduce((s, o) => s + Number(o.amount), 0) };
  });
  const maxFunilValor = Math.max(...funil.map((f) => f.valor), 1);

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
    const described = describeActivity(a, companyById, opportunities);
    return {
      id: described.id,
      kind: described.kind,
      userLabel: a.actorUserId ? memberDisplayName(a.actorUserId, memberships) : "—",
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
      </div>

      <div className="content">
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-label">Pipeline em aberto</div>
            <div className="stat-value">{brl(totalAberto)}</div>
            <div className="kpi-delta up">▲ {abertas.length} oportunidades ativas</div>
          </div>
          <div className="stat-tile blue">
            <div className="stat-label">Previsão ponderada</div>
            <div className="stat-value">{brl(ponderado)}</div>
            <div className="kpi-delta">valor × probabilidade</div>
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

        {pipeline && (
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="M18 9l-5 5-3-3-4 4" />
                </svg>
                Funil de propostas — resumo
              </div>
              <Link href="/dashboard/pipeline" className="btn btn-sm btn-ghost">
                Abrir pipeline →
              </Link>
            </div>
            <div className="panel-body">
              <div className="funnel-bar">
                {funil.map((f) => (
                  <div className="fbar" key={f.stage.id}>
                    <div className="fbar-label">{f.stage.name}</div>
                    <div className="fbar-track">
                      <div className="fbar-fill" style={{ width: `${Math.max((f.valor / maxFunilValor) * 100, 3)}%` }}>
                        {f.count} deal(s)
                      </div>
                    </div>
                    <div className="fbar-val">{brl(f.valor)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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
