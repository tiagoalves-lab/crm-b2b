import Link from "next/link";
import { hasPermission } from "@/lib/api/permission-catalog";
import type { Activity, Membership } from "@/lib/api/types";
import { effectiveTier, scoreReasons, TIER_LABEL } from "@/lib/api/raw-leads";
import { formatDateOnlyBR, formatDateTimeBR } from "@/lib/format-date";
import type { LeadFicha } from "./load";
import { currentAbaOf } from "./ficha-tabs";
import AddNoteForm from "../../empresas/_ficha/add-note-form";
import ContactItem from "../../empresas/_ficha/contact-item";
import AddContactForm from "../../empresas/_ficha/add-contact-form";
import LeadCnpjEditor from "../lead-cnpj-editor";
import LeadSegmentoEditor from "../lead-segmento-editor";
import LeadTagsEditor from "../lead-tags-editor";
import { formatCnpj } from "../cnpj-lookup-fields";

const SUBTIPO_LABEL: Record<string, string> = {
  nota: "Anotação",
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
};

// Cor por tipo de registro — mesmas chaves de empresas/_ficha/ficha-body.tsx
// (gama-crm-mvp.html, DB.interactionTypes), reusadas nas classes
// .note-type-btn/.timeline-item/.pill do globals.css.
const SUBTIPO_COLOR: Record<string, string> = {
  nota: "purple",
  ligacao: "blue",
  reuniao: "green",
  visita: "amber",
  email: "red",
};

// Nome de quem registrou o item da Timeline — o próprio usuário pelo nome
// do JWT (2026-08-03) e qualquer outro membro pelo nome de GET
// /memberships (2026-09-04). Mesmo critério de
// empresas/_ficha/ficha-body.tsx.
function memberLabel(
  userId: string | null,
  currentUserId: string,
  currentUserName: string | null | undefined,
  memberships: Membership[],
): string {
  if (!userId) return "Sistema";
  if (userId === currentUserId) return currentUserName?.trim() || "Você";
  const membro = memberships.find((m) => m.userId === userId);
  return membro?.name?.trim() || membro?.login?.trim() || `${userId.slice(0, 8)}…`;
}

function ActivityItem({
  activity,
  currentUserId,
  currentUserName,
  memberships,
}: {
  activity: Activity;
  currentUserId: string;
  currentUserName?: string | null;
  memberships: Membership[];
}) {
  const payload = activity.payload as { texto?: string; subtipo?: string; contatoNome?: string };
  const subtipo =
    payload.subtipo ?? (activity.type === "call" ? "ligacao" : activity.type === "email" ? "email" : "nota");
  const color = SUBTIPO_COLOR[subtipo] ?? "gray";
  return (
    <div className={`timeline-item type-${color}`}>
      <div className="timeline-item-head">
        <span className={`pill pill-${color}`}>{SUBTIPO_LABEL[subtipo] ?? subtipo}</span>
        <span>{memberLabel(activity.actorUserId, currentUserId, currentUserName, memberships)}</span>
        {payload.contatoNome && <span>· {payload.contatoNome}</span>}
        <span>{formatDateTimeBR(activity.occurredAt)}</span>
      </div>
      {payload.texto && <div className="timeline-item-body">{payload.texto}</div>}
    </div>
  );
}

// Conteúdo das 4 abas da ficha do lead (protótipo: renderLeadFicha em
// gama-crm-mvp.html, "Contatos" é adição fora do protótipo) —
// compartilhado entre a versão drawer e a versão full-page. Aprovar/
// Descartar saíram daqui (viviam só na aba "dados") e foram pro cabeçalho
// da ficha (leads/[id]/page.tsx e @drawer/(.)leads/[id]/page.tsx), visível
// não importa qual aba esteja aberta.
export default function FichaBody({ data, aba }: { data: LeadFicha; aba?: string }) {
  const { me, lead, companyId, activities, tasks, contacts, accessRestricted, memberships } = data;
  const currentAba = currentAbaOf(aba);
  const tier = effectiveTier(lead);
  // Mesmo critério de empresas/_ficha/ficha-body.tsx: vem da matriz
  // granular de permissões (módulo "contatos"), não mais fixo em
  // owner/admin.
  const canEditContacts = hasPermission(me.membership.role, me.membership.permissions, "contatos", "editar");
  const canRemoveContacts = hasPermission(me.membership.role, me.membership.permissions, "contatos", "excluir");
  // CNPJ editável só enquanto o lead está em triagem (aprovado/descartado
  // não muda mais) e pra quem pode editar leads — o backend confere de
  // novo (PATCH /raw-leads/:id/cadastro, mustBeNovo + PolicyService).
  const canEditCadastro =
    lead.status === "novo" && hasPermission(me.membership.role, me.membership.permissions, "leads", "editar");

  if (currentAba === "timeline") {
    return (
      <>
        {companyId && !accessRestricted && (
          <div className="add-note">
            <AddNoteForm
              companyId={companyId}
              subtipoOptions={Object.entries(SUBTIPO_LABEL).map(([value, label]) => ({ value, label }))}
              contacts={contacts}
              placeholder="Registrar contato com este lead... (mesmo antes de aprovar, o histórico fica guardado)"
            />
          </div>
        )}
        {accessRestricted ? (
          <p className="empty">Sem acesso ao histórico desta empresa (ainda não tem responsável atribuído).</p>
        ) : (
          <div className="timeline">
            {activities.length > 0 ? (
              activities.map((a) => (
                <ActivityItem
                  key={a.id}
                  activity={a}
                  currentUserId={me.user.id}
                  currentUserName={me.user.name}
                  memberships={memberships}
                />
              ))
            ) : (
              <p className="empty">Nenhum contato registrado ainda. Use o campo acima para anotar a primeira conversa.</p>
            )}
          </div>
        )}
      </>
    );
  }

  if (currentAba === "tarefas") {
    return (
      <>
        {companyId && !accessRestricted && (
          <div style={{ marginBottom: 14 }}>
            <Link href={`/dashboard/leads/${lead.id}/nova-tarefa`} className="btn btn-primary btn-sm">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Criar tarefa
            </Link>
          </div>
        )}
        {accessRestricted ? (
          <p className="empty">Sem acesso às tarefas desta empresa (ainda não tem responsável atribuído).</p>
        ) : tasks.length > 0 ? (
          tasks.map((t) => (
            <div key={t.id} className="drawer-list-item">
              <div>
                <div className="dli-title">{t.title}</div>
                <div className="dli-sub">{t.dueAt ? `vence ${formatDateOnlyBR(t.dueAt)}` : "sem prazo"}</div>
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

  if (currentAba === "contatos") {
    return (
      <>
        {companyId && !accessRestricted && (
          <AddContactForm companyId={companyId} />
        )}
        {accessRestricted ? (
          <p className="empty">Sem acesso aos contatos desta empresa (ainda não tem responsável atribuído).</p>
        ) : companyId && contacts.length > 0 ? (
          contacts.map((c) => (
            <ContactItem
              key={c.id}
              contact={c}
              companyId={companyId}
              canEdit={canEditContacts}
              canRemove={canRemoveContacts}
            />
          ))
        ) : (
          <p className="empty">Nenhum contato cadastrado ainda.</p>
        )}
      </>
    );
  }

  // dados
  return (
    <>
      <dl className="kv">
        <dt>CNPJ</dt>
        <dd>{canEditCadastro ? <LeadCnpjEditor leadId={lead.id} cnpj={lead.cnpj} /> : formatCnpj(lead.cnpj) || "—"}</dd>
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
        <dt>Segmento</dt>
        <dd>
          <LeadSegmentoEditor leadId={lead.id} segmento={lead.segmento} />
        </dd>
        <dt>Situação</dt>
        <dd>{lead.situacao ?? "—"}</dd>
        <dt>Recuperação judicial</dt>
        <dd>
          {lead.emRecuperacaoJudicial ? (
            <span className="pill pill-red" title="Indicativo da Receita Federal, removido da razão social">
              ⚠ Em recuperação
            </span>
          ) : (
            "Não"
          )}
        </dd>
        <dt>Importador</dt>
        <dd>{lead.importador ? <span style={{ color: "var(--green)" }}>Sim (Comex Stat)</span> : "Não"}</dd>
        <dt>Score</dt>
        <dd>
          <span className={`tier-tag tier-${tier}`}>
            {lead.score} — {TIER_LABEL[tier]}
          </span>
        </dd>
        <dt>Cálculo</dt>
        <dd style={{ fontSize: 12, color: "var(--text-secondary)" }}>{scoreReasons(lead).join(" · ")}</dd>
        <dt>Tags</dt>
        <dd>
          <LeadTagsEditor leadId={lead.id} tags={lead.tags} />
        </dd>
      </dl>
    </>
  );
}
