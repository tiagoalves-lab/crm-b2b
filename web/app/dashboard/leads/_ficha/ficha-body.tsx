import Link from "next/link";
import { hasPermission } from "@/lib/api/permission-catalog";
import { ehConversao, textoDaConversao } from "@/lib/api/activities";
import type { Activity, Membership } from "@/lib/api/types";
import { effectiveTier, TIER_LABEL } from "@/lib/api/raw-leads";
import { formatDateTimeBR, formatPrazoBR } from "@/lib/format-date";
import type { LeadFicha } from "./load";
import { currentAbaOf } from "./ficha-tabs";
import AddNoteForm from "../../empresas/_ficha/add-note-form";
import ContactItem from "../../empresas/_ficha/contact-item";
import AddContactForm from "../../empresas/_ficha/add-contact-form";
import EquipeEditor from "../equipe-editor";
import LeadCnpjEditor from "../lead-cnpj-editor";
import LeadSegmentoEditor from "../lead-segmento-editor";
import LeadTagsEditor from "../lead-tags-editor";
import CartaoReceita from "../../empresas/_ficha/cartao-receita";
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
  // Conversão do lead (2026-10-28) — mesma linha de empresas/_ficha/ficha-body.tsx.
  if (ehConversao(activity)) {
    return (
      <div className="timeline-item type-gray">
        <div className="timeline-item-head">
          <span className="pill pill-gray">Conversão</span>
          <span>{memberLabel(activity.actorUserId, currentUserId, currentUserName, memberships)}</span>
          <span>{formatDateTimeBR(activity.occurredAt)}</span>
        </div>
        <div className="timeline-item-body">{textoDaConversao(activity)}</div>
      </div>
    );
  }
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

// Conteúdo das 5 abas da ficha do lead (protótipo: renderLeadFicha em
// gama-crm-mvp.html; "Contatos" e "Equipe de vendas" são adições fora do
// protótipo) —
// compartilhado entre a versão drawer e a versão full-page. Aprovar/
// Descartar saíram daqui (viviam só na aba "dados") e foram pro cabeçalho
// da ficha (leads/[id]/page.tsx e @drawer/(.)leads/[id]/page.tsx), visível
// não importa qual aba esteja aberta.
export default function FichaBody({ data, aba }: { data: LeadFicha; aba?: string }) {
  const { me, lead, companyId, company, activities, tasks, contacts, team, accessRestricted, memberships } = data;
  const currentAba = currentAbaOf(aba);
  const tier = effectiveTier(lead);
  // Mesmo critério de empresas/_ficha/ficha-body.tsx: vem da matriz
  // granular de permissões (módulo "contatos"), não mais fixo em
  // owner/admin.
  const canEditContacts = hasPermission(me.membership.role, me.membership.permissions, "contatos", "editar");
  const canRemoveContacts = hasPermission(me.membership.role, me.membership.permissions, "contatos", "excluir");
  const podeLigar = hasPermission(me.membership.role, me.membership.permissions, "telefonia", "criar");
  // CNPJ editável em triagem e em lead aprovado (2026-10-26: corrigir CNPJ
  // errado depois de aprovar); descartado não muda mais. Só pra quem pode
  // editar leads — o backend confere de novo (PATCH /raw-leads/:id/cadastro).
  const podeEditarLeads = hasPermission(me.membership.role, me.membership.permissions, "leads", "editar");
  const canEditCadastro = lead.status !== "descartado" && podeEditarLeads;
  // Reconsultar a Receita pelo CNPJ já salvo vale em qualquer status
  // (2026-10-07) — o backend só barra a troca de CNPJ fora da triagem.
  const canBuscarReceita = podeEditarLeads && Boolean(lead.cnpj);

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
                <div className="dli-sub">
                  {t.dueAt ? `vence ${formatPrazoBR(t.dueAt, t.dueHasTime)}` : "sem prazo"}
                </div>
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

  if (currentAba === "equipe") {
    return (
      <>
        {accessRestricted || !companyId || !team ? (
          <p className="empty">Sem acesso à equipe de vendas desta empresa.</p>
        ) : (
          <EquipeEditor companyId={companyId} team={team} memberships={memberships} />
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
              podeLigar={podeLigar}
            />
          ))
        ) : (
          <p className="empty">Nenhum contato cadastrado ainda.</p>
        )}
      </>
    );
  }

  // dados — mesmo cartão da Receita da ficha da empresa (2026-10-28: a
  // lista simples daqui foi trocada a pedido do usuário). Sem acesso à
  // empresa por trás do lead, cai nos campos que o próprio lead guarda.
  return (
    <>
      {canEditCadastro || canBuscarReceita ? (
        <LeadCnpjEditor leadId={lead.id} cnpj={lead.cnpj} podeAlterar={canEditCadastro} />
      ) : null}

      {company ? (
        <CartaoReceita company={company} back={`/dashboard/leads/${lead.id}?aba=dados`} />
      ) : (
        <div className="cad-grid">
          <div className="cad-cell">
            <div className="cad-k">CNPJ</div>
            <div className="cad-v mono">{formatCnpj(lead.cnpj) || "—"}</div>
          </div>
          <div className="cad-cell">
            <div className="cad-k">Situação cadastral</div>
            <div className="cad-v">{lead.situacao ?? "—"}</div>
          </div>
          <div className="cad-cell full">
            <div className="cad-k">CNAE principal</div>
            <div className="cad-v mono">
              {lead.cnaePrincipal ?? "—"} — {lead.cnaeDescricao ?? "—"}
            </div>
          </div>
          <div className="cad-cell">
            <div className="cad-k">Local</div>
            <div className="cad-v">
              {lead.municipio ?? "—"}
              {lead.uf ? `/${lead.uf}` : ""}
            </div>
          </div>
          <div className="cad-cell">
            <div className="cad-k">Porte</div>
            <div className="cad-v">{lead.porte ?? "—"}</div>
          </div>
        </div>
      )}

      <div className="drawer-section-title" style={{ marginTop: 24 }}>
        Prospecção
      </div>
      <div className="cad-grid">
        <div className="cad-cell full">
          <div className="cad-k">Segmento</div>
          <div className="cad-v">
            <LeadSegmentoEditor leadId={lead.id} segmento={lead.segmento} />
          </div>
        </div>
        <div className="cad-cell">
          <div className="cad-k">Classificação</div>
          <div className="cad-v">
            {tier ? <span className={`tier-tag tier-${tier}`}>{TIER_LABEL[tier]}</span> : "Sem classificação"}
          </div>
        </div>
        <div className="cad-cell">
          <div className="cad-k">Tags</div>
          <div className="cad-v">
            <LeadTagsEditor leadId={lead.id} tags={lead.tags} />
          </div>
        </div>
      </div>
    </>
  );
}
