import Link from "next/link";
import { getMe } from "@/lib/api/me";
import { getRawLead, scoreTier } from "@/lib/api/raw-leads";
import { listActivities } from "@/lib/api/activities";
import { listTasks } from "@/lib/api/tasks";
import type { Activity } from "@/lib/api/types";
import { createNoteAction } from "../empresas/actions";
import { createTaskAction } from "../tarefas/actions";
import { approveOneLeadAction, discardOneLeadAction } from "./actions";

type Aba = "timeline" | "tarefas" | "dados";
const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "timeline", label: "Histórico" },
  { id: "tarefas", label: "Tarefas" },
  { id: "dados", label: "Dados do lead" },
];

const SUBTIPO_LABEL: Record<string, string> = {
  nota: "Nota",
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
};

const TIER_LABEL: Record<string, string> = { quente: "Quente", morno: "Morno", frio: "Frio" };
const TIER_BADGE: Record<string, string> = {
  quente: "badge badge-accent",
  morno: "badge",
  frio: "badge badge-danger",
};

function memberLabel(userId: string | null, currentUserId: string): string {
  if (!userId) return "Sistema";
  if (userId === currentUserId) return "Você";
  return `${userId.slice(0, 8)}…`;
}

function ActivityItem({ activity, currentUserId }: { activity: Activity; currentUserId: string }) {
  const payload = activity.payload as { texto?: string; subtipo?: string };
  const subtipo =
    payload.subtipo ?? (activity.type === "call" ? "ligacao" : activity.type === "email" ? "email" : "nota");
  return (
    <div className="timeline-item">
      <div className="timeline-item-head">
        <strong>{SUBTIPO_LABEL[subtipo] ?? subtipo}</strong>
        <span>{memberLabel(activity.actorUserId, currentUserId)}</span>
        <span>{new Date(activity.occurredAt).toLocaleString("pt-BR")}</span>
      </div>
      {payload.texto && <div className="timeline-item-body">{payload.texto}</div>}
    </div>
  );
}

// Ficha do lead antes de aprovar (SPEC-CRM-GAMA.md §4.4) — Histórico/
// Tarefas leem direto de activities/tasks filtrados pelo companyId da
// company-lead (criada junto com o raw_lead, ver RawLeadService.create),
// reusando as mesmas Server Actions que a ficha de Empresa já usa
// (createNoteAction/createTaskAction) — é a mesma entidade por baixo.
export default async function LeadFicha({
  token,
  leadId,
  aba,
  error,
}: {
  token: string;
  leadId: string;
  aba?: string;
  error?: string;
}) {
  const currentAba: Aba = ABAS.find((a) => a.id === aba)?.id ?? "timeline";
  const [me, lead] = await Promise.all([getMe(token), getRawLead(token, leadId)]);

  const companyId = lead.promotedCompanyId;
  const [{ items: activities }, { items: tasks }] = companyId
    ? await Promise.all([listActivities(token, { companyId }), listTasks(token, { companyId })])
    : [{ items: [] as Activity[] }, { items: [] }];

  const tier = scoreTier(lead.score);
  const abaHref = (a: Aba) => `/dashboard/leads?lead=${leadId}&aba=${a}`;
  const isNovo = lead.status === "novo";

  return (
    <div className="content-wide">
      <Link
        href="/dashboard/leads"
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 12, display: "inline-block" }}
      >
        ← Leads
      </Link>

      <div className="toolbar">
        <div className="panel-head">
          <h2>{lead.razaoSocial}</h2>
          <p className="sub">
            {lead.cnpj ?? "sem CNPJ"}
            {lead.municipio ? ` · ${lead.municipio}${lead.uf ? `/${lead.uf}` : ""}` : ""}
          </p>
        </div>
        <div className="row-form">
          <span className={TIER_BADGE[tier]}>
            score {lead.score} — {TIER_LABEL[tier]}
          </span>
          {!isNovo && <span className="badge">{lead.status === "aprovado" ? "aprovado" : "descartado"}</span>}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="view-tabs" style={{ marginBottom: 16 }}>
        {ABAS.map((a) => (
          <Link key={a.id} href={abaHref(a.id)} className={currentAba === a.id ? "view-tab active" : "view-tab"}>
            {a.label}
            {a.id === "timeline" && ` (${activities.length})`}
            {a.id === "tarefas" && ` (${tasks.length})`}
          </Link>
        ))}
      </div>

      {currentAba === "timeline" && (
        <>
          {companyId && (
            <div className="form-panel">
              <form action={createNoteAction} className="form-grid">
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="back" value={abaHref("timeline")} />
                <label>
                  Tipo
                  <select name="subtipo" defaultValue="nota">
                    {Object.entries(SUBTIPO_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Registrar contato com este lead
                  <textarea
                    name="texto"
                    rows={3}
                    placeholder="O que foi conversado, próximos passos... (mesmo antes de aprovar, o histórico fica guardado)"
                    required
                  />
                </label>
                <button type="submit" className="btn btn-primary">
                  Registrar
                </button>
              </form>
            </div>
          )}
          {activities.length > 0 ? (
            activities.map((a) => <ActivityItem key={a.id} activity={a} currentUserId={me.user.id} />)
          ) : (
            <p className="sub">Nenhum contato registrado ainda. Use o campo acima pra anotar a primeira conversa.</p>
          )}
        </>
      )}

      {currentAba === "tarefas" && (
        <>
          {companyId && (
            <div className="form-panel">
              <form action={createTaskAction} className="form-grid">
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="back" value={abaHref("tarefas")} />
                <label style={{ gridColumn: "1 / -1" }}>
                  Nova tarefa para este lead
                  <input name="title" required />
                </label>
                <label>
                  Prazo
                  <input name="dueAt" type="date" />
                </label>
                <button type="submit" className="btn btn-primary">
                  Criar tarefa
                </button>
              </form>
            </div>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Prazo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{t.dueAt ? new Date(t.dueAt).toLocaleDateString("pt-BR") : "—"}</td>
                  <td>
                    <span className={t.status === "done" ? "badge badge-accent" : "badge"}>
                      {t.status === "done" ? "Concluída" : "Pendente"}
                    </span>
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                    Nenhuma tarefa. Crie uma pra não esquecer de dar sequência neste lead.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {currentAba === "dados" && (
        <>
          <table className="data-table">
            <tbody>
              <tr>
                <td>CNPJ</td>
                <td>{lead.cnpj ?? "—"}</td>
              </tr>
              <tr>
                <td>CNAE</td>
                <td>
                  {lead.cnaePrincipal ?? "—"} — {lead.cnaeDescricao ?? "—"}
                </td>
              </tr>
              <tr>
                <td>Local</td>
                <td>
                  {lead.municipio ?? "—"}
                  {lead.uf ? `/${lead.uf}` : ""}
                </td>
              </tr>
              <tr>
                <td>Porte</td>
                <td>{lead.porte ?? "—"}</td>
              </tr>
              <tr>
                <td>Situação</td>
                <td>{lead.situacao ?? "—"}</td>
              </tr>
              <tr>
                <td>Importador</td>
                <td>{lead.importador ? "Sim (Comex Stat)" : "Não"}</td>
              </tr>
              <tr>
                <td>Origem</td>
                <td style={{ textTransform: "uppercase" }}>{lead.fonte}</td>
              </tr>
              <tr>
                <td>Score</td>
                <td>
                  <span className={TIER_BADGE[tier]}>
                    {lead.score} — {TIER_LABEL[tier]}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {isNovo && (
            <div className="row-form" style={{ marginTop: 20 }}>
              <form action={approveOneLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="back" value="/dashboard/leads" />
                <button type="submit" className="btn btn-primary">
                  Aprovar (vira empresa)
                </button>
              </form>
              <form action={discardOneLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="back" value="/dashboard/leads" />
                <button type="submit" className="btn btn-danger">
                  Descartar
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
