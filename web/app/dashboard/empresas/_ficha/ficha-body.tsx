import { companyDisplayName } from "@/lib/api/companies";
import { hasPermission } from "@/lib/api/permission-catalog";
import type { Activity } from "@/lib/api/types";
import { formatDateBR, formatDateTimeBR } from "@/lib/format-date";
import type { FichaData } from "./load";
import { currentAbaOf } from "./ficha-tabs";
import { refreshCnpjDataAction, updateCustomFieldsAction } from "../actions";
import AddNoteForm from "./add-note-form";
import ContactItem from "./contact-item";
import AddContactForm from "./add-contact-form";
import SubmitButton from "@/app/_components/submit-button";

const SUBTIPO_LABEL: Record<string, string> = {
  nota: "Anotação",
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
  posvenda: "Pós-venda",
};

// Cor por tipo de registro (gama-crm-mvp.html, DB.interactionTypes) —
// mesmas chaves usadas em .note-type-btn/.timeline-item/.pill no
// globals.css. "posvenda" não existe no protótipo (subtipo próprio deste
// projeto) — cinza neutro.
const SUBTIPO_COLOR: Record<string, string> = {
  nota: "purple",
  ligacao: "blue",
  reuniao: "green",
  visita: "amber",
  email: "red",
  posvenda: "gray",
};

// Enum `indicadorIE` do eGestor (docs/api-egestor-contatos.md: 1 =
// Contribuinte, 2 = Isento de IE, 9 = Não contribuinte) — substituiu o
// checkbox booleano "Contribuinte de ICMS" em 2026-08-17 (decisão do
// usuário). O rótulo é o texto que ele pediu; o valor guardado é só o
// número, que é o que a API do eGestor aceita.
const INDICADOR_IE_OPCOES: Array<{ valor: string; label: string }> = [
  { valor: "1", label: "1 - Contribuinte do ICMS" },
  { valor: "2", label: "2 - Contribuinte Isento" },
  { valor: "9", label: "9 - Não Contribuinte" },
];

// customFields é jsonb — o valor pode voltar como número (o que gravamos)
// ou string. Só 1/2/9 são aceitos; qualquer outra coisa vira "não
// informado", nunca um valor inválido indo parar no ERP.
function indicadorIeSalvo(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return INDICADOR_IE_OPCOES.some((o) => o.valor === texto) ? texto : "";
}

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
  estabelecimento?: string | null;
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
  return formatDateBR(value);
}

// Pedido do usuário (2026-08-03): em vez de "Você", mostrar o nome real
// de quem está logado. `currentUserName` vem do user_metadata.name do JWT
// (ver web/lib/api/types.ts#AuthenticatedUser) — cai pra "Você" se o
// usuário não tiver nome cadastrado (contas antigas, ou nunca preenchido).
function memberLabel(
  userId: string | null,
  currentUserId: string,
  currentUserName?: string | null,
): string {
  if (!userId) return "Sistema";
  if (userId === currentUserId) return currentUserName?.trim() || "Você";
  return `${userId.slice(0, 8)}…`;
}

function ActivityItem({
  activity,
  currentUserId,
  currentUserName,
}: {
  activity: Activity;
  currentUserId: string;
  currentUserName?: string | null;
}) {
  const payload = activity.payload as { texto?: string; subtipo?: string; contatoNome?: string };
  const subtipo =
    payload.subtipo ?? (activity.type === "call" ? "ligacao" : activity.type === "email" ? "email" : "nota");
  const color = SUBTIPO_COLOR[subtipo] ?? "gray";
  return (
    <div className={`timeline-item type-${color}`}>
      <div className="timeline-item-head">
        <span className={`pill pill-${color}`}>{SUBTIPO_LABEL[subtipo] ?? subtipo}</span>
        <span>{memberLabel(activity.actorUserId, currentUserId, currentUserName)}</span>
        {payload.contatoNome && <span>· {payload.contatoNome}</span>}
        <span>{formatDateTimeBR(activity.occurredAt)}</span>
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
  const { me, company, activities, tasks, opportunities, salesHistory, salesItems, contacts } = data;
  const currentAba = currentAbaOf(aba);
  const abaHref = (a: string) => `/dashboard/empresas/${company.id}?aba=${a}`;
  // Editar/Remover contato: vem da matriz granular de permissões (módulo
  // "contatos", ver lib/api/permission-catalog.ts), não mais fixo em
  // owner/admin (regra antiga até 2026-08-12) — ContactService#update/
  // remove no backend já checa canModule('contatos', 'editar'/'excluir'),
  // isto aqui só decide se cada botão aparece.
  const canEditContacts = hasPermission(me.membership.role, me.membership.permissions, "contatos", "editar");
  const canRemoveContacts = hasPermission(me.membership.role, me.membership.permissions, "contatos", "excluir");

  const wonOpps = opportunities.filter((o) => o.status === "won" && !o.deletedAt);
  const openOpps = opportunities.filter((o) => o.status === "open" && !o.deletedAt);
  // LTV soma Opportunity "won" (pipeline novo) + sales_history (histórico
  // importado do eGestor, sem Opportunity — ver web/app/dashboard/empresas/page.tsx).
  const ltv =
    wonOpps.reduce((s, o) => s + Number(o.amount), 0) +
    salesHistory.reduce((s, v) => s + Number(v.valorTotal), 0);
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
          <ActivityItem activity={ultimaAtividade} currentUserId={me.user.id} currentUserName={me.user.name} />
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
    const indicadorIE = indicadorIeSalvo(company.customFields.indicador_ie);
    const indicadorIELabel = INDICADOR_IE_OPCOES.find((o) => o.valor === indicadorIE)?.label;

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
            <SubmitButton className="btn btn-primary" pendingLabel="Buscando…">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              Buscar dados
            </SubmitButton>
          </form>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Puxa razão social, CNAE, endereço e situação da base da Receita Federal (via BrasilAPI). A
            Inscrição Estadual é dado da SEFAZ e entra à parte, abaixo.
          </div>
        </div>

        {/* Indicativo próprio (não depende de ter buscado a Receita nesta
            aba — vem de company.emRecuperacaoJudicial, setado no cadastro
            manual, na importação por planilha ou na busca por CNPJ). */}
        {company.emRecuperacaoJudicial && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            ⚠ Empresa em recuperação judicial na Receita Federal — indicativo removido da razão
            social e mantido só aqui.
          </div>
        )}

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
                <div className="cad-v">{company.razaoSocial ?? companyDisplayName(company)}</div>
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
              <div className="cad-cell">
                <div className="cad-k">Estabelecimento</div>
                <div className="cad-v">{cad.estabelecimento ?? "—"}</div>
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

        {temIE || indicadorIELabel ? (
          <div className="cad-grid">
            <div className="cad-cell">
              <div className="cad-k">Inscrição Estadual</div>
              <div className="cad-v mono">
                {temIE ? String(company.customFields.inscricao_estadual) : "—"}
              </div>
            </div>
            <div className="cad-cell full">
              <div className="cad-k">Indicador de IE</div>
              <div className="cad-v">
                {indicadorIELabel ? (
                  <span className={`badge-contrib ${indicadorIE === "9" ? "nao" : "sim"}`}>
                    {indicadorIELabel}
                  </span>
                ) : (
                  "Não informado"
                )}
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
          <label>
            Indicador de IE
            <select name="indicador_ie" defaultValue={indicadorIE}>
              <option value="">Não informado</option>
              {INDICADOR_IE_OPCOES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton className="btn btn-primary" pendingLabel="Salvando…">
            Salvar dados estaduais
          </SubmitButton>
        </form>
      </>
    );
  }

  if (currentAba === "contatos") {
    return (
      <>
        <div className="drawer-section-title">Novo contato</div>
        <AddContactForm companyId={company.id} />

        {contacts.length > 0 ? (
          contacts.map((c) => (
            <ContactItem
              key={c.id}
              contact={c}
              companyId={company.id}
              canEdit={canEditContacts}
              canRemove={canRemoveContacts}
            />
          ))
        ) : (
          <p className="sub">Nenhum contato cadastrado ainda.</p>
        )}
      </>
    );
  }

  if (currentAba === "timeline") {
    return (
      <>
        <div className="add-note">
          <AddNoteForm
            companyId={company.id}
            subtipoOptions={Object.entries(SUBTIPO_LABEL).map(([value, label]) => ({ value, label }))}
            contacts={contacts}
            placeholder="O que foi conversado, próximos passos..."
          />
        </div>
        <div className="timeline">
          {activities.length > 0 ? (
            activities.map((a) => <ActivityItem key={a.id} activity={a} currentUserId={me.user.id} currentUserName={me.user.name} />)
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

  // Vendas — o que o eGestor registrou de compra desta empresa. Colunas
  // pedidas pelo usuário (2026-08-21): Cód., Estabelecimento, Vendedor,
  // Data e Total.
  if (currentAba === "vendas") {
    if (salesHistory.length === 0) {
      return <p className="sub">Nenhuma venda registrada no eGestor para esta empresa.</p>;
    }
    const total = salesHistory.reduce((s, v) => s + Number(v.valorTotal), 0);
    return (
      <>
        <div className="ov-stat green" style={{ marginBottom: 16 }}>
          <div className="ov-stat-l">Total comprado</div>
          <div className="ov-stat-v">{brl(total)}</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Cód.</th>
                <th>Estabelecimento</th>
                <th>Vendedor</th>
                <th>Data</th>
                <th style={COL_NUM}>Total</th>
              </tr>
            </thead>
            <tbody>
              {salesHistory.map((v) => (
                <tr key={v.id}>
                  <td>{v.codVenda}</td>
                  <td>{v.estabelecimento === "matriz" ? "Matriz" : "Filial"}</td>
                  <td>{v.vendedorNome ?? "—"}</td>
                  <td>{fmtDate(v.dtVenda)}</td>
                  <td style={COL_NUM}>{brl(Number(v.valorTotal))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  // ABC de Produtos / Serviços — mesma tabela, muda só o tipo do item e
  // se a classe A/B/C aparece. Ver curvaAbc() no fim do arquivo.
  if (currentAba === "abc" || currentAba === "servicos") {
    const ehAbc = currentAba === "abc";
    const linhas = curvaAbc(salesItems.filter((i) => i.tipo === (ehAbc ? "produto" : "servico")));
    if (linhas.length === 0) {
      return (
        <p className="sub">
          {ehAbc
            ? "Nenhum produto vendido para esta empresa."
            : "Nenhum serviço prestado para esta empresa."}
        </p>
      );
    }
    const total = linhas.reduce((s, l) => s + l.valor, 0);
    return (
      <>
        <div className="ov-stat green" style={{ marginBottom: 16 }}>
          <div className="ov-stat-l">{ehAbc ? "Total em produtos" : "Total em serviços"}</div>
          <div className="ov-stat-v">{brl(total)}</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {ehAbc && <th>Classe</th>}
                <th>{ehAbc ? "Produto" : "Serviço"}</th>
                <th style={COL_NUM}>Qtd.</th>
                <th style={COL_NUM}>Total</th>
                <th style={COL_NUM}>% do total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave}>
                  {ehAbc && (
                    <td>
                      <span
                        className={
                          l.classe === "A"
                            ? "pill pill-green"
                            : l.classe === "B"
                              ? "pill pill-amber"
                              : "pill pill-blue"
                        }
                      >
                        {l.classe}
                      </span>
                    </td>
                  )}
                  <td>{l.descricao}</td>
                  <td style={COL_NUM}>
                    {l.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                  </td>
                  <td style={COL_NUM}>{brl(l.valor)}</td>
                  <td style={COL_NUM}>{l.percentual.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
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
        posvendaActivities.map((a) => <ActivityItem key={a.id} activity={a} currentUserId={me.user.id} currentUserName={me.user.name} />)
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

// Coluna numérica (quantidade, valor, percentual). `nowrap` é o que
// impede "R$ 1.700.367,23" de quebrar em duas linhas quando a descrição do
// produto é longa; `width: 1%` faz a coluna encolher até o tamanho exato
// do conteúdo, sobrando o resto da largura pra descrição — sem isso a
// tabela distribui espaço igual e espreme justamente o valor.
const COL_NUM = { textAlign: "right", whiteSpace: "nowrap", width: "1%" } as const;

// Curva ABC clássica: agrupa os itens iguais, ordena do que mais pesa em
// dinheiro pro que menos pesa e classifica pelo acumulado — A até 80% do
// valor, B até 95%, C o resto. Agrupa por código do produto quando ele
// existe (o nome pode variar entre vendas) e cai pra descrição quando não.
//
// Aqui e não no backend porque é conta de exibição sobre uma lista que a
// tela já tem na mão — não vale uma rota nova nem um cálculo guardado que
// envelhece a cada venda nova.
interface LinhaAbc {
  chave: string;
  descricao: string;
  quantidade: number;
  valor: number;
  percentual: number;
  classe: "A" | "B" | "C";
}

function curvaAbc(
  itens: Array<{ codProduto: string | null; descricao: string; quantidade: string; valorTotal: string }>,
): LinhaAbc[] {
  const agrupado = new Map<string, { descricao: string; quantidade: number; valor: number }>();
  for (const item of itens) {
    const chave = item.codProduto ?? `d:${item.descricao}`;
    const atual = agrupado.get(chave) ?? { descricao: item.descricao, quantidade: 0, valor: 0 };
    atual.quantidade += Number(item.quantidade);
    atual.valor += Number(item.valorTotal);
    agrupado.set(chave, atual);
  }

  const linhas = [...agrupado.entries()].sort((a, b) => b[1].valor - a[1].valor);
  const total = linhas.reduce((s, [, v]) => s + v.valor, 0);
  // Total zero (venda inteiramente bonificada, por exemplo) não pode virar
  // divisão por zero: nesse caso todo mundo é C, que é o que a curva quer
  // dizer de qualquer forma.
  let acumulado = 0;

  return linhas.map(([chave, v]) => {
    const percentual = total > 0 ? (v.valor / total) * 100 : 0;
    // Classe pelo acumulado ANTES deste item — quem atravessa a linha dos
    // 80% ainda é A. Olhando o acumulado depois, o último item da lista
    // cairia sempre em C (e um produto único seria C sozinho).
    const classe: LinhaAbc["classe"] = acumulado < 80 ? "A" : acumulado < 95 ? "B" : "C";
    acumulado += percentual;
    return { chave, descricao: v.descricao, quantidade: v.quantidade, valor: v.valor, percentual, classe };
  });
}
