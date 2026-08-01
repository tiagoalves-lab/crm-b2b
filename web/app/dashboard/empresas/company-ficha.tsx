import Link from "next/link";
import { getMe } from "@/lib/api/me";
import { getCompany } from "@/lib/api/companies";
import { listActivities } from "@/lib/api/activities";
import { listTasks } from "@/lib/api/tasks";
import { listOpportunities } from "@/lib/api/opportunities";
import type { Activity } from "@/lib/api/types";
import CompanyForm from "./company-form";
import { createNoteAction, updateCustomFieldsAction } from "./actions";

type Aba = "overview" | "cadastro" | "timeline" | "tarefas" | "negocios" | "posvenda";
const ABAS: Array<{ id: Aba; label: string }> = [
  { id: "overview", label: "Visão geral" },
  { id: "cadastro", label: "Dados cadastrais" },
  { id: "timeline", label: "Timeline" },
  { id: "tarefas", label: "Tarefas" },
  { id: "negocios", label: "Oportunidades" },
  { id: "posvenda", label: "Pós-venda" },
];

const SUBTIPO_LABEL: Record<string, string> = {
  nota: "Nota",
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
  posvenda: "Pós-venda",
};

function brl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function memberLabel(userId: string | null, currentUserId: string): string {
  if (!userId) return "Sistema";
  if (userId === currentUserId) return "Você";
  return `${userId.slice(0, 8)}…`;
}

function ActivityItem({ activity, currentUserId }: { activity: Activity; currentUserId: string }) {
  const payload = activity.payload as { texto?: string; subtipo?: string };
  const subtipo = payload.subtipo ?? (activity.type === "call" ? "ligacao" : activity.type === "email" ? "email" : "nota");
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

export default async function CompanyFicha({
  token,
  companyId,
  aba,
  error,
}: {
  token: string;
  companyId: string;
  aba?: string;
  error?: string;
}) {
  const currentAba: Aba = ABAS.find((a) => a.id === aba)?.id ?? "overview";

  const [me, company, { items: activities }, { items: tasks }, { items: opportunities }] =
    await Promise.all([
      getMe(token),
      getCompany(token, companyId),
      listActivities(token, { companyId }),
      listTasks(token, { companyId }),
      listOpportunities(token, { companyId }),
    ]);

  const abaHref = (a: Aba) => `/dashboard/empresas?empresa=${companyId}&aba=${a}`;
  const wonOpps = opportunities.filter((o) => o.status === "won" && !o.deletedAt);
  const openOpps = opportunities.filter((o) => o.status === "open" && !o.deletedAt);
  const isCliente = wonOpps.length > 0;
  const ltv = wonOpps.reduce((s, o) => s + Number(o.amount), 0);
  const emNegociacao = openOpps.reduce((s, o) => s + Number(o.amount), 0);
  const tarefasAbertas = tasks.filter((t) => t.status === "pending").length;
  const ultimaAtividade = activities[0];
  const posvendaActivities = activities.filter(
    (a) => (a.payload as { subtipo?: string }).subtipo === "posvenda",
  );

  return (
    <div className="content-wide">
      <Link href="/dashboard/empresas" className="btn btn-ghost btn-sm" style={{ marginBottom: 12, display: "inline-block" }}>
        ← Empresas
      </Link>

      <div className="toolbar">
        <div className="panel-head">
          <h2>{company.name}</h2>
          <p className="sub">
            {company.cpfCnpj ?? "sem CPF/CNPJ"}
            {company.cidade ? ` · ${company.cidade}${company.uf ? `/${company.uf}` : ""}` : ""}
          </p>
        </div>
        <span className={isCliente ? "badge badge-accent" : "badge"}>
          {isCliente ? "cliente" : "lead"}
        </span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="view-tabs" style={{ marginBottom: 16 }}>
        {ABAS.map((a) => (
          <Link
            key={a.id}
            href={abaHref(a.id)}
            className={currentAba === a.id ? "view-tab active" : "view-tab"}
          >
            {a.label}
            {a.id === "timeline" && ` (${activities.length})`}
            {a.id === "tarefas" && ` (${tasks.length})`}
            {a.id === "negocios" && ` (${opportunities.length})`}
          </Link>
        ))}
      </div>

      {currentAba === "overview" && (
        <>
          <div className="stat-grid">
            <div className="stat-tile green">
              <div className="stat-label">LTV (ganho)</div>
              <div className="stat-value">{brl(ltv)}</div>
            </div>
            <div className="stat-tile blue">
              <div className="stat-label">Em negociação</div>
              <div className="stat-value">{brl(emNegociacao)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Interações</div>
              <div className="stat-value">{activities.length}</div>
            </div>
            <div className="stat-tile purple">
              <div className="stat-label">Tarefas abertas</div>
              <div className="stat-value">{tarefasAbertas}</div>
            </div>
          </div>

          <div className="panel-head">
            <h3 style={{ fontSize: 14 }}>Última atividade</h3>
          </div>
          {ultimaAtividade ? (
            <ActivityItem activity={ultimaAtividade} currentUserId={me.user.id} />
          ) : (
            <p className="sub">Sem interações ainda.</p>
          )}

          <div className="panel-head" style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 14 }}>Oportunidades ativas</h3>
          </div>
          {openOpps.length > 0 ? (
            <table className="data-table">
              <tbody>
                {openOpps.map((o) => (
                  <tr key={o.id}>
                    <td>{o.currency} {Number(o.amount).toLocaleString("pt-BR")}</td>
                    <td>{o.expectedCloseDate ? new Date(o.expectedCloseDate).toLocaleDateString("pt-BR") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="sub">Nenhuma oportunidade aberta.</p>
          )}
        </>
      )}

      {currentAba === "cadastro" && (
        <>
          <CompanyForm company={company} backHref={abaHref("cadastro")} />

          <div className="form-panel">
            <div className="panel-head">
              <h3 style={{ fontSize: 14 }}>Dados fiscais estaduais (SEFAZ/ICMS)</h3>
            </div>
            <p className="sub" style={{ marginBottom: 10 }}>
              A Receita Federal não fornece Inscrição Estadual — preenchimento manual.
            </p>
            <form action={updateCustomFieldsAction} className="form-grid">
              <input type="hidden" name="id" value={company.id} />
              <input type="hidden" name="back" value={abaHref("cadastro")} />
              <label>
                Inscrição Estadual
                <input
                  name="inscricao_estadual"
                  defaultValue={String(company.customFields.inscricao_estadual ?? "")}
                />
              </label>
              <label className="row-form" style={{ alignItems: "center" }}>
                <input
                  type="checkbox"
                  name="contribuinte_icms"
                  defaultChecked={company.customFields.contribuinte_icms === true}
                  style={{ width: "auto" }}
                />
                Contribuinte de ICMS
              </label>
              <label>
                Situação cadastral (estadual)
                <input
                  name="situacao_cadastral"
                  defaultValue={String(company.customFields.situacao_cadastral ?? "")}
                />
              </label>
              <button type="submit" className="btn btn-primary">
                Salvar dados fiscais
              </button>
            </form>
          </div>
        </>
      )}

      {currentAba === "timeline" && (
        <>
          <div className="form-panel">
            <form action={createNoteAction} className="form-grid">
              <input type="hidden" name="companyId" value={company.id} />
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
                Registrar interação
                <textarea
                  name="texto"
                  rows={3}
                  placeholder="O que foi conversado, próximos passos..."
                  required
                />
              </label>
              <button type="submit" className="btn btn-primary">
                Registrar
              </button>
            </form>
          </div>
          {activities.length > 0 ? (
            activities.map((a) => (
              <ActivityItem key={a.id} activity={a} currentUserId={me.user.id} />
            ))
          ) : (
            <p className="sub">Nenhuma interação registrada ainda.</p>
          )}
        </>
      )}

      {currentAba === "tarefas" && (
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
                  Nenhuma tarefa vinculada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {currentAba === "negocios" && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Valor</th>
              <th>Status</th>
              <th>Previsão/fechamento</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <tr key={o.id}>
                <td>{o.currency} {Number(o.amount).toLocaleString("pt-BR")}</td>
                <td>
                  <span
                    className={
                      o.status === "won" ? "badge badge-accent" : o.status === "lost" ? "badge badge-danger" : "badge"
                    }
                  >
                    {o.status === "won" ? "Ganho" : o.status === "lost" ? "Perdido" : "Aberto"}
                  </span>
                </td>
                <td>
                  {(o.closedAt ?? o.expectedCloseDate)
                    ? new Date(o.closedAt ?? o.expectedCloseDate!).toLocaleDateString("pt-BR")
                    : "—"}
                </td>
              </tr>
            ))}
            {opportunities.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                  Nenhuma oportunidade registrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {currentAba === "posvenda" && (
        <>
          {wonOpps.length > 0 && (
            <div className="stat-tile" style={{ marginBottom: 16 }}>
              <div className="stat-label">Oportunidades ganhas</div>
              <div style={{ marginTop: 8 }}>
                {wonOpps.map((o) => (
                  <div key={o.id} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    {o.currency} {Number(o.amount).toLocaleString("pt-BR")}
                    {o.closedAt && ` — fechado em ${new Date(o.closedAt).toLocaleDateString("pt-BR")}`}
                  </div>
                ))}
              </div>
            </div>
          )}
          {posvendaActivities.length > 0 ? (
            posvendaActivities.map((a) => (
              <ActivityItem key={a.id} activity={a} currentUserId={me.user.id} />
            ))
          ) : (
            <p className="sub">
              {wonOpps.length > 0
                ? 'Registre a primeira nota de pós-venda na aba Timeline (tipo "Pós-venda").'
                : "Disponível quando houver uma oportunidade ganha."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
