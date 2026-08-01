import type { Activity } from "@/lib/api/types";
import type { FichaData } from "./load";
import { currentAbaOf } from "./ficha-tabs";
import {
  createNoteAction,
  refreshCnpjDataAction,
  updateCustomFieldsAction,
} from "../actions";

const SUBTIPO_LABEL: Record<string, string> = {
  nota: "Nota",
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
  posvenda: "Pós-venda",
};

// Snapshot salvo em customFields.cnpj_lookup por refreshCnpjDataAction —
// ver comentário lá (web/app/dashboard/empresas/actions.ts) sobre por que
// isso não vira coluna própria.
interface CnpjLookupSnapshot {
  situacaoCadastral?: string | null;
  dataAbertura?: string | null;
  porte?: string | null;
  naturezaJuridica?: string | null;
  cnaePrincipal?: string | null;
  cnaeSecundarios?: string[];
  telefoneReceita?: string | null;
  emailReceita?: string | null;
  fonteFederal?: string;
  buscadoEm?: string;
}

function brl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

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

// Conteúdo das 6 abas da ficha (protótipo: renderFicha/renderCadastro em
// gama-crm-mvp.html) — compartilhado entre a versão drawer (interceptada)
// e a versão full-page (fallback de acesso direto), que só diferem na
// moldura em volta (ver empresas/[id]/page.tsx e
// @drawer/(.)empresas/[id]/page.tsx).
export default function FichaBody({ data, aba }: { data: FichaData; aba?: string }) {
  const { me, company, activities, tasks, opportunities } = data;
  const currentAba = currentAbaOf(aba);
  const abaHref = (a: string) => `/dashboard/empresas/${company.id}?aba=${a}`;

  const wonOpps = opportunities.filter((o) => o.status === "won" && !o.deletedAt);
  const openOpps = opportunities.filter((o) => o.status === "open" && !o.deletedAt);
  const ltv = wonOpps.reduce((s, o) => s + Number(o.amount), 0);
  const emNegociacao = openOpps.reduce((s, o) => s + Number(o.amount), 0);
  const tarefasAbertas = tasks.filter((t) => t.status === "pending").length;
  const ultimaAtividade = activities[0];
  const posvendaActivities = activities.filter(
    (a) => (a.payload as { subtipo?: string }).subtipo === "posvenda",
  );

  if (currentAba === "overview") {
    return (
      <>
        <div className="overview-grid">
          <div className="ov-stat green">
            <div className="ov-stat-l">LTV (ganho)</div>
            <div className="ov-stat-v">{brl(ltv)}</div>
          </div>
          <div className="ov-stat blue">
            <div className="ov-stat-l">Em negociação</div>
            <div className="ov-stat-v">{brl(emNegociacao)}</div>
          </div>
          <div className="ov-stat">
            <div className="ov-stat-l">Interações</div>
            <div className="ov-stat-v">{activities.length}</div>
          </div>
          <div className="ov-stat purple">
            <div className="ov-stat-l">Tarefas abertas</div>
            <div className="ov-stat-v">{tarefasAbertas}</div>
          </div>
        </div>

        <div className="drawer-section-title">Última atividade</div>
        {ultimaAtividade ? (
          <ActivityItem activity={ultimaAtividade} currentUserId={me.user.id} />
        ) : (
          <p className="sub">Sem interações ainda.</p>
        )}

        <div className="drawer-section-title">Oportunidades ativas</div>
        {openOpps.length > 0 ? (
          openOpps.map((o) => (
            <div key={o.id} className="drawer-list-item">
              <div>
                <div className="dli-title">
                  {o.currency} {Number(o.amount).toLocaleString("pt-BR")}
                </div>
                <div className="dli-sub">
                  {o.expectedCloseDate ? `previsão ${fmtDate(o.expectedCloseDate)}` : "sem previsão"}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="sub">Nenhuma oportunidade aberta.</p>
        )}
      </>
    );
  }

  if (currentAba === "cadastro") {
    const cad = company.customFields.cnpj_lookup as CnpjLookupSnapshot | undefined;
    const temIE = Boolean(company.customFields.inscricao_estadual);

    return (
      <>
        <div className="cnpj-search">
          <form action={refreshCnpjDataAction} className="cnpj-search-row">
            <input type="hidden" name="id" value={company.id} />
            <input type="hidden" name="back" value={abaHref("cadastro")} />
            <div className="field">
              <label>Consultar CNPJ na Receita</label>
              <input name="cnpj" defaultValue={company.cpfCnpj ?? ""} placeholder="00.000.000/0001-00" />
            </div>
            <button type="submit" className="btn btn-primary">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              Buscar dados
            </button>
          </form>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Puxa razão social, CNAE, endereço e situação da base da Receita Federal (via BrasilAPI). A
            Inscrição Estadual é dado da SEFAZ e entra à parte, abaixo.
          </div>
        </div>

        {!cad ? (
          <div className="cad-empty">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6M9 15h6M9 11h2" />
            </svg>
            <p>
              Nenhum dado cadastral ainda. Clique em <b>Buscar dados</b> acima para puxar a ficha da
              Receita Federal automaticamente.
            </p>
          </div>
        ) : (
          <>
            <div className="cad-source">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {cad.fonteFederal ?? "Receita Federal · BrasilAPI"} · consultado em {fmtDate(cad.buscadoEm)}
            </div>
            <div className="cad-grid">
              <div className="cad-cell">
                <div className="cad-k">Razão social</div>
                <div className="cad-v">{company.razaoSocial ?? company.name}</div>
              </div>
              <div className="cad-cell">
                <div className="cad-k">Nome fantasia</div>
                <div className="cad-v">{company.fantasia ?? "—"}</div>
              </div>
              <div className="cad-cell">
                <div className="cad-k">CNPJ</div>
                <div className="cad-v mono">{company.cpfCnpj ?? "—"}</div>
              </div>
              <div className="cad-cell">
                <div className="cad-k">Situação cadastral</div>
                <div className="cad-v">
                  <span className={`badge-contrib ${cad.situacaoCadastral === "ATIVA" ? "sim" : "nao"}`}>
                    {cad.situacaoCadastral ?? "—"}
                  </span>
                </div>
              </div>
              <div className="cad-cell">
                <div className="cad-k">Abertura</div>
                <div className="cad-v">{fmtDate(cad.dataAbertura)}</div>
              </div>
              <div className="cad-cell">
                <div className="cad-k">Porte</div>
                <div className="cad-v">{cad.porte ?? "—"}</div>
              </div>
              <div className="cad-cell full">
                <div className="cad-k">Natureza jurídica</div>
                <div className="cad-v">{cad.naturezaJuridica ?? "—"}</div>
              </div>
              <div className="cad-cell full">
                <div className="cad-k">CNAE principal</div>
                <div className="cad-v mono">{cad.cnaePrincipal ?? "—"}</div>
              </div>
              <div className="cad-cell full">
                <div className="cad-k">CNAE secundários</div>
                <div className="cnae-list">
                  {cad.cnaeSecundarios && cad.cnaeSecundarios.length > 0 ? (
                    cad.cnaeSecundarios.map((c) => (
                      <span key={c} className="cnae-chip">
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="cad-v">—</span>
                  )}
                </div>
              </div>
              <div className="cad-cell full">
                <div className="cad-k">Endereço</div>
                <div className="cad-v">
                  {[company.logradouro, company.numero, company.bairro].filter(Boolean).join(", ") || "—"}
                  {" · "}
                  {company.cep ?? "—"} · {company.cidade ?? "—"}
                  {company.uf ? `/${company.uf}` : ""}
                </div>
              </div>
              <div className="cad-cell">
                <div className="cad-k">Telefone (Receita)</div>
                <div className="cad-v">{cad.telefoneReceita ?? "—"}</div>
              </div>
              <div className="cad-cell">
                <div className="cad-k">E-mail (Receita)</div>
                <div className="cad-v">{cad.emailReceita ?? "—"}</div>
              </div>
            </div>
          </>
        )}

        <div className="drawer-section-title" style={{ marginTop: 24 }}>
          Dados estaduais (SEFAZ / ICMS)
        </div>
        <div className="cad-source estadual">
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          Fonte estadual (SINTEGRA) · {temIE ? "preenchido manualmente" : "preenchimento manual — a Receita não fornece IE"}
        </div>

        {temIE ? (
          <div className="cad-grid">
            <div className="cad-cell">
              <div className="cad-k">Inscrição Estadual</div>
              <div className="cad-v mono">{String(company.customFields.inscricao_estadual)}</div>
            </div>
            <div className="cad-cell full">
              <div className="cad-k">Contribuinte de ICMS</div>
              <div className="cad-v">
                <span className={`badge-contrib ${company.customFields.contribuinte_icms ? "sim" : "nao"}`}>
                  {company.customFields.contribuinte_icms ? "SIM — contribuinte" : "NÃO contribuinte"}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="cad-empty" style={{ padding: 22 }}>
            <p style={{ marginBottom: 0 }}>
              Inscrição Estadual não preenchida. Consulte no SINTEGRA do estado e registre manualmente
              abaixo.
            </p>
          </div>
        )}

        <form action={updateCustomFieldsAction} className="form-grid" style={{ marginTop: 14 }}>
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
            Salvar dados estaduais
          </button>
        </form>
      </>
    );
  }

  if (currentAba === "timeline") {
    return (
      <>
        <div className="add-note">
          <form action={createNoteAction}>
            <input type="hidden" name="companyId" value={company.id} />
            <input type="hidden" name="back" value={abaHref("timeline")} />
            <div className="add-note-types">
              {Object.entries(SUBTIPO_LABEL).map(([value, label], i) => (
                <label key={value} className="note-type-btn" style={{ cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="subtipo"
                    value={value}
                    defaultChecked={i === 0}
                    style={{ display: "none" }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <textarea name="texto" placeholder="O que foi conversado, próximos passos..." required />
            <div className="add-note-foot">
              <button type="submit" className="btn btn-primary btn-sm">
                Registrar
              </button>
            </div>
          </form>
        </div>
        <div className="timeline">
          {activities.length > 0 ? (
            activities.map((a) => <ActivityItem key={a.id} activity={a} currentUserId={me.user.id} />)
          ) : (
            <p className="sub">Nenhuma interação registrada ainda.</p>
          )}
        </div>
      </>
    );
  }

  if (currentAba === "tarefas") {
    return tasks.length > 0 ? (
      <>
        {tasks.map((t) => (
          <div key={t.id} className="drawer-list-item">
            <div>
              <div className="dli-title">{t.title}</div>
              <div className="dli-sub">{t.dueAt ? `prazo ${fmtDate(t.dueAt)}` : "sem prazo"}</div>
            </div>
            <span className={t.status === "done" ? "pill pill-green" : "pill pill-gray"}>
              {t.status === "done" ? "Concluída" : "Pendente"}
            </span>
          </div>
        ))}
      </>
    ) : (
      <p className="sub">Nenhuma tarefa vinculada.</p>
    );
  }

  if (currentAba === "negocios") {
    return opportunities.length > 0 ? (
      <>
        {opportunities.map((o) => (
          <div key={o.id} className="drawer-list-item">
            <div>
              <div className="dli-title">
                {o.currency} {Number(o.amount).toLocaleString("pt-BR")}
              </div>
              <div className="dli-sub">
                {o.closedAt ? `encerrado ${fmtDate(o.closedAt)}` : `previsão ${fmtDate(o.expectedCloseDate)}`}
              </div>
            </div>
            <span
              className={
                o.status === "won" ? "pill pill-blue" : o.status === "lost" ? "pill pill-red" : "pill pill-amber"
              }
            >
              {o.status === "won" ? "Ganho" : o.status === "lost" ? "Perdido" : "Aberto"}
            </span>
          </div>
        ))}
      </>
    ) : (
      <p className="sub">Nenhuma oportunidade registrada.</p>
    );
  }

  // posvenda
  return (
    <>
      {wonOpps.length > 0 && (
        <div className="ov-stat blue" style={{ marginBottom: 16 }}>
          <div className="ov-stat-l">Oportunidades ganhas</div>
          <div style={{ marginTop: 8 }}>
            {wonOpps.map((o) => (
              <div key={o.id} className="drawer-list-item">
                <div className="dli-title">
                  {o.currency} {Number(o.amount).toLocaleString("pt-BR")}
                </div>
                {o.closedAt && <div className="dli-sub">fechado em {fmtDate(o.closedAt)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {posvendaActivities.length > 0 ? (
        posvendaActivities.map((a) => <ActivityItem key={a.id} activity={a} currentUserId={me.user.id} />)
      ) : (
        <div className="posvenda-empty">
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          {wonOpps.length > 0
            ? 'Registre a primeira nota de pós-venda na aba Timeline (tipo "Pós-venda").'
            : "Disponível quando houver uma oportunidade ganha."}
        </div>
      )}
    </>
  );
}
