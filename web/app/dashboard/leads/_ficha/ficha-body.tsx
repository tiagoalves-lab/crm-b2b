import type { Activity } from "@/lib/api/types";
import { scoreReasons, scoreTier } from "@/lib/api/raw-leads";
import type { LeadFicha } from "./load";
import { currentAbaOf } from "./ficha-tabs";
import { createNoteAction } from "../../empresas/actions";
import { createTaskAction } from "../../tarefas/actions";
import { approveOneLeadAction, discardOneLeadAction } from "../actions";

const SUBTIPO_LABEL: Record<string, string> = {
  nota: "Nota",
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
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

// Conteúdo das 3 abas da ficha do lead (protótipo: renderLeadFicha em
// gama-crm-mvp.html) — compartilhado entre a versão drawer e a versão
// full-page.
export default function FichaBody({ data, aba }: { data: LeadFicha; aba?: string }) {
  const { me, lead, companyId, activities, tasks } = data;
  const currentAba = currentAbaOf(aba);
  const abaHref = (a: string) => `/dashboard/leads/${lead.id}?aba=${a}`;
  const tier = scoreTier(lead.score);
  const isNovo = lead.status === "novo";

  if (currentAba === "timeline") {
    return (
      <>
        {companyId && (
          <div className="add-note">
            <form action={createNoteAction}>
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="back" value={abaHref("timeline")} />
              <div className="add-note-types">
                {Object.entries(SUBTIPO_LABEL).map(([value, label], i) => (
                  <label key={value} className="note-type-btn" style={{ cursor: "pointer" }}>
                    <input type="radio" name="subtipo" value={value} defaultChecked={i === 0} style={{ display: "none" }} />
                    {label}
                  </label>
                ))}
              </div>
              <textarea
                name="texto"
                placeholder="Registrar contato com este lead... (mesmo antes de aprovar, o histórico fica guardado)"
                required
              />
              <div className="add-note-foot">
                <button type="submit" className="btn btn-primary btn-sm">
                  Registrar
                </button>
              </div>
            </form>
          </div>
        )}
        <div className="timeline">
          {activities.length > 0 ? (
            activities.map((a) => <ActivityItem key={a.id} activity={a} currentUserId={me.user.id} />)
          ) : (
            <p className="empty">Nenhum contato registrado ainda. Use o campo acima para anotar a primeira conversa.</p>
          )}
        </div>
      </>
    );
  }

  if (currentAba === "tarefas") {
    return (
      <>
        {companyId && (
          <form action={createTaskAction} className="form-grid" style={{ marginBottom: 14 }}>
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
            <button type="submit" className="btn btn-primary btn-sm">
              Criar tarefa
            </button>
          </form>
        )}
        {tasks.length > 0 ? (
          tasks.map((t) => (
            <div key={t.id} className="drawer-list-item">
              <div>
                <div className="dli-title">{t.title}</div>
                <div className="dli-sub">{t.dueAt ? `vence ${new Date(t.dueAt).toLocaleDateString("pt-BR")}` : "sem prazo"}</div>
              </div>
              <span className={t.status === "done" ? "pill pill-green" : "pill pill-gray"}>
                {t.status === "done" ? "Concluída" : "Pendente"}
              </span>
            </div>
          ))
        ) : (
          <p className="empty">Nenhuma tarefa. Crie uma para não esquecer de dar sequência neste lead.</p>
        )}
      </>
    );
  }

  // dados
  return (
    <>
      <dl className="kv">
        <dt>CNPJ</dt>
        <dd>{lead.cnpj ?? "—"}</dd>
        <dt>CNAE</dt>
        <dd>
          {lead.cnaePrincipal ?? "—"} — {lead.cnaeDescricao ?? "—"}
        </dd>
        <dt>Local</dt>
        <dd>
          {lead.municipio ?? "—"}
          {lead.uf ? `/${lead.uf}` : ""}
        </dd>
        <dt>Porte</dt>
        <dd>{lead.porte ?? "—"}</dd>
        <dt>Situação</dt>
        <dd>{lead.situacao ?? "—"}</dd>
        <dt>Importador</dt>
        <dd>{lead.importador ? <span style={{ color: "var(--green)" }}>Sim (Comex Stat)</span> : "Não"}</dd>
        <dt>Origem</dt>
        <dd style={{ textTransform: "uppercase" }}>{lead.fonte}</dd>
        <dt>Score</dt>
        <dd>
          <span className={`tier-tag tier-${tier}`}>
            {lead.score} — {tier}
          </span>
        </dd>
        <dt>Cálculo</dt>
        <dd style={{ fontSize: 12, color: "var(--text-secondary)" }}>{scoreReasons(lead).join(" · ")}</dd>
      </dl>

      {isNovo && (
        <div className="row-form" style={{ marginTop: 20 }}>
          <form action={approveOneLeadAction}>
            <input type="hidden" name="id" value={lead.id} />
            <input type="hidden" name="back" value="/dashboard/leads" />
            <button type="submit" className="btn btn-primary">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
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
  );
}
