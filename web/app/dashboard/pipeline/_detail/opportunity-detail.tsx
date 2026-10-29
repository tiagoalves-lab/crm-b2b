"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useContext, useEffect, useRef, useState } from "react";
import { companyRazaoSocialName } from "@/lib/api/companies";
import { formatCnpj } from "@/app/dashboard/leads/cnpj-lookup-fields";
import type {
  Activity,
  Contact,
  Membership,
  OpportunityComment,
  OpportunityItem,
  OpportunityWithDetails,
} from "@/lib/api/types";
import type { OpportunityAttachment } from "@/lib/api/opportunity-attachments";
import { formatDateBR, formatDateOnlyBR, formatDateTimeBR } from "@/lib/format-date";
import { REFRESH_SESSION_KEY, TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { AttachmentsSection } from "@/app/dashboard/_overlay/attachments";
import type { OpportunityDetail } from "./load";
import MotivoPerdaModal from "./motivo-perda-modal";
import StandbyModal from "./standby-modal";
import {
  addOpportunityCommentAction,
  addOpportunityItemAction,
  deleteOpportunityClientAction,
  opportunityAttachmentUrlAction,
  removeOpportunityAttachmentClientAction,
  publishOpportunityAttachmentClientAction,
  removeOpportunityCommentAction,
  listOpportunityHistoryAction,
  removeOpportunityItemAction,
  saveOpportunityDetailAction,
  setOpportunityCommentMentionsAction,
  setOpportunityCommentPinnedAction,
  setOpportunityMentionDoneAction,
  setOpportunityItemAmountAction,
  setOpportunityStandbyAction,
  setOpportunityStatusAction,
  updateOpportunityCommentAction,
} from "../actions";
import { ItemsPanel, TagChips, TagPicker } from "./item-tags";
import HistoricoSection from "./historico";
import { TextoTrello } from "./texto-trello";
import { enviarAnexosOportunidade } from "./enviar-anexos";
import NovaForm from "@/app/dashboard/tarefas/nova/nova-form";
import { novaTarefaContextoAction } from "@/app/dashboard/tarefas/actions";
import type { AssigneeOption } from "@/lib/api/assignee-options";

// Card da oportunidade (modal interceptado e página cheia) — client
// component desde 2026-09-03, mesmo molde da ficha de tarefa
// (tarefas/_detail/task-detail.tsx): cada botão chama uma Server Action
// que devolve resultado, o card atualiza o próprio estado na hora e um
// refresh em segundo plano (useRefresh, _overlay/refresh.ts) põe o quadro
// atrás em dia mesmo que o card seja fechado antes de ele chegar. Antes cada
// botão era <form action> com revalidatePath()+redirect(), que dentro do
// @modal travava ou fechava-e-reabria o card.

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

type Busy =
  | "status"
  | "standby"
  | "save"
  | "delete"
  | "comment"
  | "upload"
  | `comment:${string}`
  | `pin:${string}`
  | `pendencia:${string}`
  | `destaque:${string}`
  | `editar:${string}`
  | `attach:${string}`
  | `download:${string}`
  | `publish:${string}`
  | "item"
  | `item:${string}`
  | `valor:${string}`
  | null;

interface OpportunityDetailState {
  data: OpportunityDetail;
  opportunity: OpportunityWithDetails;
  attachments: OpportunityAttachment[];
  busy: Busy;
  error: string | null;
  notice: string | null;
  isModal: boolean;
  setOpportunity: (updater: (prev: OpportunityWithDetails) => OpportunityWithDetails) => void;
  setAttachments: (list: OpportunityAttachment[]) => void;
  // Lista lateral de itens (2026-09-04) — ver item-tags.tsx.
  items: OpportunityItem[];
  setItems: Dispatch<SetStateAction<OpportunityItem[]>>;
  run: <T>(key: Busy, fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void, notice?: string) => Promise<void>;
  setStatus: (status: "won" | "open" | "lost", noticeText: string, lostReason?: string) => Promise<void>;
  // Stand by (2026-10-22): `dayKey` é a nova previsão de fechamento,
  // obrigatória ao colocar; ausente ao retomar.
  setStandby: (standby: boolean, dayKey?: string) => Promise<void>;
  remove: () => Promise<void>;
  close: () => void;
  // Histórico do card (2026-09-14): o botão mora no rodapé e o painel no
  // corpo — dois componentes irmãos —, por isso o estado fica aqui. A
  // lista só é buscada na primeira vez que o botão é apertado.
  historicoAberto: boolean;
  historico: Activity[] | null;
  historicoErro: string | null;
  historicoCarregando: boolean;
  toggleHistorico: () => void;
  // Tarefa nova dentro do próprio card (2026-10-29): o botão mora em "Mais
  // ações" e o formulário no corpo, por isso o estado fica aqui.
  tarefaAberta: boolean;
  setTarefaAberta: (aberta: boolean) => void;
  tarefaCriada: (mensagem: string) => void;
}

const OpportunityDetailContext = createContext<OpportunityDetailState | null>(null);

// Teto de espera pelo refresh antes de fechar o card depois de Marcar
// Fechada/Reabrir (normalmente chega em ~1 s).
const FECHAR_EM_MS = 5000;

function useOpportunityDetail(): OpportunityDetailState {
  const ctx = useContext(OpportunityDetailContext);
  if (!ctx) throw new Error("useOpportunityDetail fora de OpportunityDetailProvider");
  return ctx;
}

export function OpportunityDetailProvider({
  data,
  isModal,
  children,
}: {
  data: OpportunityDetail;
  isModal: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [opportunity, setOpportunityState] = useState<OpportunityWithDetails>(data.opportunity);
  const [attachments, setAttachments] = useState<OpportunityAttachment[]>(data.attachments);
  const [items, setItems] = useState<OpportunityItem[]>(data.opportunity.items ?? []);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [historico, setHistorico] = useState<Activity[] | null>(null);
  const [historicoErro, setHistoricoErro] = useState<string | null>(null);
  const [historicoCarregando, setHistoricoCarregando] = useState(false);
  const [tarefaAberta, setTarefaAberta] = useState(false);
  const refresh = useRefresh();
  // Marcar Fechada/Reabrir fecham o card (ver setStatus): só depois que o
  // refresh chegou — o quadro de trás recarrega junto — ou, se ele
  // demorar mais que FECHAR_EM_MS, fecha assim mesmo com a marca de
  // refresh pendente de pé (o Toast refresca ao chegar no quadro).
  const closeWhenFresh = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOpportunityState(data.opportunity);
    setAttachments(data.attachments);
    setItems(data.opportunity.items ?? []);
    // Dados novos do servidor: o histórico guardado ficou velho — com o
    // painel aberto, busca de novo; fechado, só descarta.
    setHistorico(null);
    if (historicoAberto) carregarHistorico();
    if (closeWhenFresh.current) {
      closeWhenFresh.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const setOpportunity = (updater: (prev: OpportunityWithDetails) => OpportunityWithDetails) =>
    setOpportunityState((prev) => updater(prev));

  async function run<T>(
    key: Busy,
    fn: () => Promise<ActionResult<T>>,
    onOk: (data: T) => void,
    noticeText?: string,
  ) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onOk(res.data);
      if (noticeText) setNotice(noticeText);
      markRefreshPending();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  // Enquanto a ficha está aberta, nada de router.refresh(): dentro de uma
  // rota interceptada ele re-resolve a árvore e o Next devolve a PÁGINA
  // CHEIA da mesma URL no lugar do modal — foi o "modal virou tela cheia"
  // que o usuário viu ao anexar um arquivo (2026-09-04). Em vez disso a
  // marca de refresh pendente fica de pé e o Toast (no layout) dispara o
  // refresh assim que a tela muda, ao fechar a ficha: a lista de trás
  // chega em dia do mesmo jeito, com uma ida a menos ao servidor por
  // clique. Quem ainda refresca na hora é setStatus, que precisa esperar
  // a resposta chegar pra fechar a ficha.
  function markRefreshPending() {
    sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
  }

  function close() {
    if (isModal) router.back();
    else router.push("/dashboard/pipeline");
  }

  // Busca a trilha do card no servidor. Chamada ao abrir o painel e
  // sempre que o card recebe dados novos com o painel aberto — assim o
  // histórico mostra também a mudança que acabou de ser feita.
  function carregarHistorico() {
    setHistoricoCarregando(true);
    setHistoricoErro(null);
    void listOpportunityHistoryAction(data.opportunity.id)
      .then((res) => {
        if (res.ok) setHistorico(res.data);
        else setHistoricoErro(res.message);
      })
      .catch(() => setHistoricoErro("Não deu pra carregar o histórico. Tente de novo."))
      .finally(() => setHistoricoCarregando(false));
  }

  function tarefaCriada(mensagem: string) {
    setTarefaAberta(false);
    setNotice(mensagem);
    markRefreshPending();
  }

  function toggleHistorico() {
    const abrindo = !historicoAberto;
    setHistoricoAberto(abrindo);
    if (abrindo && !historicoCarregando) carregarHistorico();
  }

  // Mesmo fluxo de Concluir/Reabrir da ficha de tarefa (task-detail.tsx,
  // 2026-09-04): a mudança de status fecha o card e o resultado aparece
  // no quadro (card na coluna certa + toast), em vez de trocar o botão
  // pelo oposto no mesmo lugar com o quadro de trás ainda desatualizado.
  async function setStatus(status: "won" | "open" | "lost", noticeText: string, lostReason?: string) {
    await mudarSituacao(
      "status",
      () => setOpportunityStatusAction(opportunity.id, opportunity.version, status, lostReason),
      noticeText,
    );
  }

  // Colocar em Stand by / retomar (2026-10-22) tira ou devolve o card ao
  // quadro — mesmo fluxo de Fechada/Reabrir: fecha o card e o resultado
  // aparece no quadro.
  async function setStandby(standby: boolean, dayKey?: string) {
    await mudarSituacao(
      "standby",
      () => setOpportunityStandbyAction(opportunity.id, opportunity.version, standby, dayKey),
      standby ? "Oportunidade em stand by" : "Negociação retomada",
    );
  }

  async function mudarSituacao(
    key: "status" | "standby",
    fn: () => Promise<ActionResult<Partial<OpportunityWithDetails>>>,
    noticeText: string,
  ) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.message);
        setBusy(null);
        return;
      }
      setOpportunityState((prev) => ({ ...prev, ...res.data }));
      sessionStorage.setItem(TOAST_SESSION_KEY, noticeText);
      closeWhenFresh.current = true;
      refresh();
      closeTimer.current = setTimeout(() => {
        if (!closeWhenFresh.current) return;
        closeWhenFresh.current = false;
        close();
      }, FECHAR_EM_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado. Tente novamente.");
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm("Excluir esta oportunidade? Não dá pra desfazer.")) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await deleteOpportunityClientAction(opportunity.id);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      // Mesmo mecanismo da ficha de tarefa: o Toast (no layout) dá o
      // refresh ao chegar no quadro — refresh daqui cairia na URL do card
      // que acabou de sumir.
      sessionStorage.setItem(TOAST_SESSION_KEY, "Oportunidade excluída");
      sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <OpportunityDetailContext.Provider
      value={{
        data,
        opportunity,
        attachments,
        busy,
        error,
        notice,
        isModal,
        setOpportunity,
        setAttachments,
        items,
        setItems,
        run,
        setStatus,
        setStandby,
        remove,
        close,
        historicoAberto,
        historico,
        historicoErro,
        historicoCarregando,
        toggleHistorico,
        tarefaAberta,
        setTarefaAberta,
        tarefaCriada,
      }}
    >
      {children}
    </OpportunityDetailContext.Provider>
  );
}

function brlFull(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return formatDateBR(value);
}



// As rotas de fixar, destacar e dar baixa devolvem o comentário sem o
// histórico de edição (só o GET do card e a edição trazem) — troca o
// comentário na lista sem perder o histórico que a ficha já tem.
function trocarComentario(lista: OpportunityComment[], salvo: OpportunityComment): OpportunityComment[] {
  return lista.map((x) => (x.id === salvo.id ? { ...salvo, edits: salvo.edits ?? x.edits } : x));
}

function memberDisplayName(userId: string, memberships: Membership[]): string {
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || `${userId.slice(0, 8)}…`;
}

// Usuário-sistema do backend (SYSTEM_ACTOR_USER_ID): no card, quem anexa com
// ele é só o "Enviar proposta ao CRM" do app de cotações. Não é membro, então
// sem isso o anexo mostrava "Enviado por 00000000…".
const SISTEMA_USER_ID = "00000000-0000-4000-8000-000000000000";

function initialsOf(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

// Identificação do formulário de edição do card — o botão "Salvar" mora
// no rodapé (DetailFooter, fora da árvore do <form>), associado por
// form= (mesma solução da ficha de tarefa).
const EDIT_FORM_ID = "opportunity-edit-form";

// Cabeçalho do card (protótipo: <dl class="kv"> de openDealDetail).
// Desde 2026-09-04 o próprio card É o formulário de edição, a pedido do
// usuário: o botão "Editar", que abria outra tela só pra mudar quatro
// campos, foi apagado (rota /pipeline/[id]/editar incluída). Com a
// oportunidade aberta os campos são editáveis e "Salvar" fica no rodapé;
// encerrada, viram leitura — mesma regra de antes, quando o botão Editar
// só aparecia com a oportunidade aberta.
//
// Fora daqui de propósito: "Etapa" (quem move o card de etapa é o
// arrasto no quadro) e "Ponderado" (era o único uso da probabilidade da
// etapa na ficha) — os dois saíram a pedido do usuário.
// Valor da oportunidade quando os itens têm preço: quem manda é a soma (o
// backend grava, ver OpportunityItemService#sincronizarValor), então o
// campo vira leitura pra não existirem dois números brigando na mesma tela.
function valorDosItens(items: { amount: string | number | null }[]): number | null {
  if (!items.some((item) => item.amount !== null)) return null;
  return items.reduce<number>(
    (total, item) => (item.amount === null ? total : total + Number(item.amount)),
    0,
  );
}

// Valor da oportunidade no rodapé da coluna de Itens, como totalizador
// (pedido do usuário, 2026-10-28) — antes era um campo do formulário ao
// lado do Representante. Editável só com a oportunidade aberta e sem item
// com preço; o campo pertence ao formulário do card via form= (o "Salvar"
// do rodapé grava junto com o resto).
function ValorTotalizador() {
  const { opportunity: o, items, busy } = useOpportunityDetail();
  const soma = valorDosItens(items);
  const editavel = o.status === "open" && soma === null;
  return (
    <label className="opp-item-total">
      <span>Valor total</span>
      {editavel ? (
        <input
          name="amount"
          form={EDIT_FORM_ID}
          type="number"
          step="0.01"
          min="0"
          defaultValue={o.amount}
          disabled={busy !== null}
        />
      ) : (
        <strong title={soma !== null ? "Soma dos itens acima" : undefined}>
          {brlFull(soma ?? Number(o.amount), o.currency)}
        </strong>
      )}
    </label>
  );
}

// Cabeçalho da empresa no card (pedido do usuário, 2026-10-29): etapa do
// Kanban ao lado da razão social e o CNPJ logo abaixo. Card encerrado
// (ganho ou perdido) mostra "Concluído", não a etapa onde parou.
function EmpresaIdentificacao() {
  const { data, opportunity: o } = useOpportunityDetail();
  const { company } = data;
  const stage = data.stages.find((s) => s.id === o.stageId) ?? data.stage;
  const concluido = o.status !== "open";
  return (
    <div className="opp-empresa-id">
      <div className="opp-empresa-nome">
        <span>{companyRazaoSocialName(company)}</span>
        {concluido ? (
          <span className="opp-etapa-tag concluido">Concluído</span>
        ) : (
          stage && <span className="opp-etapa-tag">{stage.name}</span>
        )}
      </div>
      {company.cpfCnpj && <div className="opp-empresa-cnpj">{formatCnpj(company.cpfCnpj)}</div>}
    </div>
  );
}

function DetailKv() {
  const { data, opportunity: o, items, busy, setOpportunity, run } = useOpportunityDetail();
  const closed = o.status !== "open";
  const valorVemDosItens = valorDosItens(items) !== null;
  // Só membro ativo e marcado como Vendedor no cadastro de membros
  // (2026-09-17) pode receber a oportunidade — o backend recusa o resto.
  // O dono atual entra na lista mesmo sem a marcação ou inativo, senão o
  // select abriria em outro nome e o próximo "Salvar" trocaria o
  // representante sem ninguém pedir.
  const responsaveis = data.memberships.filter(
    (m) => (m.status === "active" && m.vendedor) || m.userId === o.ownerUserId,
  );

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const campo = (name: string) => {
      const v = fd.get(name);
      return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
    };
    void run(
      "save",
      () =>
        saveOpportunityDetailAction(o.id, o.version, {
          ownerUserId: campo("ownerUserId"),
          // Campo só-leitura não vai no PATCH: quem grava o valor é a
          // soma dos itens.
          amount: valorVemDosItens ? undefined : Number(fd.get("amount") ?? 0),
          currency: o.currency,
          expectedCloseDate: campo("expectedCloseDate"),
          // String vazia limpa a descrição — por isso não passa por campo().
          description: String(fd.get("description") ?? ""),
        }),
      (saved) => setOpportunity((prev) => ({ ...prev, ...saved })),
      "Oportunidade atualizada",
    );
  }

  if (closed) {
    return (
      <dl className="kv">
        <dt>Empresa</dt>
        <dd className="opp-empresa-linha">
          <EmpresaIdentificacao />
          <MaisAcoes />
        </dd>
        <dt>Representante</dt>
        <dd>{memberDisplayName(o.ownerUserId, data.memberships)}</dd>
        <dt>Encerrado em</dt>
        <dd>{fmtDate(o.closedAt)}</dd>
        {o.description && (
          <>
            <dt>Descrição</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{o.description}</dd>
          </>
        )}
        {o.status === "lost" && o.lostReason && (
          <>
            <dt>Motivo perda</dt>
            <dd style={{ color: "var(--danger)" }}>{o.lostReason}</dd>
          </>
        )}
      </dl>
    );
  }

  return (
    <>
      <dl className="kv">
        <dt>Empresa</dt>
        <dd className="opp-empresa-linha">
          <EmpresaIdentificacao />
          <MaisAcoes />
        </dd>
        {/* Stand by (2026-10-22): o card está fora do quadro. A retomada
            prevista é a previsão de fechamento logo abaixo. */}
        {o.standbyAt && (
          <>
            <dt>Situação</dt>
            <dd>
              <span className="standby-tag">Stand by</span> desde {formatDateBR(o.standbyAt)} · retomada prevista
              para {o.expectedCloseDate ? formatDateOnlyBR(o.expectedCloseDate) : "—"}
            </dd>
          </>
        )}
      </dl>
      <form id={EDIT_FORM_ID} onSubmit={handleSave} className="form-grid" style={{ marginTop: 12 }}>
        {/* Representante (2026-09-04): o dono da oportunidade é quem
            responde pela venda. Solicitação vinda do Trello já nasce com o
            representante do quadro; aqui é onde se corrige quando o quadro
            não identifica ninguém. */}
        <label>
          Representante
          <select name="ownerUserId" defaultValue={o.ownerUserId} disabled={busy !== null}>
            {responsaveis.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberDisplayName(m.userId, data.memberships)}
              </option>
            ))}
          </select>
        </label>
        {/* Valor (2026-10-28) saiu daqui: é o totalizador da coluna de
            Itens (ValorTotalizador). Moeda saiu do card (pedido do usuário, 2026-09-11): tudo é
            negociado em real. O valor gravado mantém a moeda que já
            estava na oportunidade. */}
        <label>
          Previsão de fechamento
          <input
            name="expectedCloseDate"
            type="date"
            defaultValue={o.expectedCloseDate?.slice(0, 10) ?? ""}
            disabled={busy !== null}
          />
        </label>
        {/* Descrição longa (2026-09-04): o usuário detalha aqui o que
            hoje escreve na descrição do cartão do Trello — por isso o
            campo ocupa a linha inteira e abre grande. */}
        <label style={{ gridColumn: "1 / -1" }}>
          Descrição
          <textarea
            name="description"
            rows={10}
            defaultValue={o.description ?? ""}
            disabled={busy !== null}
            placeholder="Detalhe o que está sendo negociado: modelo, opcionais, condições, prazos…"
          />
        </label>
      </form>
    </>
  );
}

export function DetailBody() {
  const {
    data,
    opportunity: o,
    attachments,
    items,
    busy,
    error,
    notice,
    setOpportunity,
    setAttachments,
    setItems,
    run,
    historicoAberto,
    historico,
    historicoErro,
    historicoCarregando,
    tarefaAberta,
  } = useOpportunityDetail();
  const { me, memberships } = data;
  const [commentText, setCommentText] = useState("");
  // Itens escolhidos pra carimbar no próximo comentário (2026-09-04).
  const [commentTags, setCommentTags] = useState<string[]>([]);
  // Membros destacados no próximo comentário (2026-09-14) — cada um
  // ganha uma pendência neste card até dar baixa.
  const [commentMentions, setCommentMentions] = useState<string[]>([]);
  const membrosParaDestacar = memberships.filter((m) => m.status === "active");
  // Comentário já publicado cujo painel "Destacar" está aberto
  // (2026-09-14) — dá pra marcar/desmarcar membro depois de escrever.
  const [editandoDestaques, setEditandoDestaques] = useState<string | null>(null);
  // Caixa de escrever comentário (2026-09-14, pedido do usuário): carimbo
  // de itens e destaque de membro saíram de cima do campo — viraram
  // ícones no rodapé da própria caixa e só abrem no clique. Guarda qual
  // painel está aberto e se o comentário já nasce fixado.
  const [painelComposer, setPainelComposer] = useState<"itens" | "membros" | null>(null);
  const [fixarAoEnviar, setFixarAoEnviar] = useState(false);
  // Edição do texto (pedido do usuário, 2026-10-16: corrigir erro de
  // digitação sem perder o histórico). Qual comentário está com a caixa
  // de edição aberta e o rascunho dela; e de qual comentário o painel de
  // versões anteriores está aberto.
  const [editandoTexto, setEditandoTexto] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [versoesDe, setVersoesDe] = useState<string | null>(null);

  function salvarEdicao(comentarioId: string) {
    const texto = rascunho.trim();
    if (!texto) return;
    void run(
      `editar:${comentarioId}`,
      () => updateOpportunityCommentAction(o.id, comentarioId, texto),
      (saved) => {
        setOpportunity((prev) => ({ ...prev, comments: trocarComentario(prev.comments, saved) }));
        setEditandoTexto(null);
      },
      "Comentário editado",
    );
  }

  // Marca/desmarca um membro num comentário que já existe. Cada clique
  // grava — a lista inteira vai pro backend, que substitui a anterior.
  function alternarDestaque(comentarioId: string, atuais: string[], userId: string) {
    const proximos = atuais.includes(userId)
      ? atuais.filter((id) => id !== userId)
      : [...atuais, userId];
    void run(
      `destaque:${comentarioId}`,
      () => setOpportunityCommentMentionsAction(o.id, comentarioId, proximos),
      (saved) =>
        setOpportunity((prev) => ({
          ...prev,
          comments: trocarComentario(prev.comments, saved),
        })),
      atuais.includes(userId) ? "Destaque removido" : "Membro destacado",
    );
  }
  const canDeleteOwn = me.membership.role !== "sales_rep";
  // Publicar anexo é de administrador/proprietário (2026-09-15) — é o
  // mesmo corte que o backend aplica; aqui só evita mostrar um botão que
  // ia voltar 403.
  const podePublicarAnexo =
    me.membership.role === "owner" || me.membership.role === "admin";
  // A lista de itens só muda com a oportunidade aberta — encerrada, fica
  // como registro (mesma regra dos botões Editar/Gerar tarefa no rodapé).
  const canEditItems = o.status === "open";
  // Comentário mais novo em cima (pedido do usuário, 2026-09-11): o card
  // tem histórico longo vindo do Trello e o andamento recente ficava no
  // fim da rolagem. Ordenado aqui, na exibição — o comentário recém-
  // escrito, que o card acrescenta no fim da lista, sobe junto.
  const comentarios = [...o.comments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  async function addItem(name: string): Promise<boolean> {
    let added = false;
    await run(
      "item",
      () => addOpportunityItemAction(o.id, name),
      (item) => {
        setItems((prev) => [...prev, item]);
        added = true;
      },
    );
    return added;
  }

  // Valor de um item (2026-09-04). O backend recalcula o valor da
  // oportunidade (soma) e devolve o item; o card aplica os dois na hora.
  function setItemAmount(itemId: string, amount: number | null) {
    void run(
      `valor:${itemId}`,
      () => setOpportunityItemAmountAction(o.id, itemId, amount),
      (saved) => {
        setItems((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
      },
    );
  }

  function removeItem(itemId: string) {
    void run(
      `item:${itemId}`,
      () => removeOpportunityItemAction(o.id, itemId),
      () => {
        setItems((prev) => prev.filter((item) => item.id !== itemId));
        const removed = items.find((item) => item.id === itemId);
        if (removed) setCommentTags((prev) => prev.filter((tag) => tag !== removed.name));
      },
      "Item removido",
    );
  }

  // Anexo sem <form> (2026-09-04): era um <form onSubmit> e bastava o
  // navegador submeter antes do React assumir o clique pra virar uma
  // navegação de verdade pra própria URL — que, fora da interceptação,
  // abre a página cheia e o modal "some". Sem form não existe submit
  // nativo: o botão lê o arquivo do input e chama a Server Action.
  //
  // Vários arquivos (2026-09-17), enviados pelo navegador direto pro
  // Storage — ver enviar-anexos.ts. Se algum falhar, os outros seguem; a
  // lista mostra o que entrou e o erro diz o que ficou de fora.
  function handleUpload(files: File[]) {
    void run(
      "upload",
      async (): Promise<ActionResult<OpportunityAttachment[]>> => {
        const { lista, falhas } = await enviarAnexosOportunidade(o.id, files);
        if (falhas.length === 0 && lista) return { ok: true, data: lista };
        // Falha parcial: o que entrou já aparece na lista, e o aviso de
        // erro nomeia só os arquivos que ficaram de fora.
        if (lista) setAttachments(lista);
        return {
          ok: false,
          message:
            falhas.length > 0
              ? `Não deu pra enviar: ${falhas.join("; ")}`
              : "Arquivos enviados, mas a lista não atualizou. Feche e abra o card.",
        };
      },
      (list) => setAttachments(list),
      files.length === 1 ? "Anexo adicionado" : `${files.length} anexos adicionados`,
    );
  }

  async function handleComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentText.trim();
    if (!body) return;
    const fixar = fixarAoEnviar;
    // O "📌" da caixa é escolha de quem escreve, não campo do comentário:
    // fixar continua sendo a mesma ação de sempre, chamada logo depois de
    // criar — o backend não precisou de campo novo.
    const novo: { id: string | null } = { id: null };
    await run(
      "comment",
      () => addOpportunityCommentAction(o.id, body, commentTags, commentMentions),
      (comment) => {
        setOpportunity((prev) => ({ ...prev, comments: [...prev.comments, comment] }));
        setCommentText("");
        setCommentTags([]);
        setCommentMentions([]);
        setPainelComposer(null);
        setFixarAoEnviar(false);
        novo.id = comment.id;
      },
    );
    const novoId = novo.id;
    if (!fixar || !novoId) return;
    await run(
      `pin:${novoId}`,
      () => setOpportunityCommentPinnedAction(o.id, novoId, true),
      (saved) =>
        setOpportunity((prev) => ({
          ...prev,
          comments: trocarComentario(prev.comments, saved),
        })),
      "Comentário fixado",
    );
  }

  // URL assinada e temporária do arquivo, gerada só no clique (nunca
  // antecipada na listagem). Quem exibe é a prévia do AttachmentsSection.
  async function urlDoAnexo(attachmentId: string): Promise<string | null> {
    const box: { url: string | null } = { url: null };
    await run(
      `download:${attachmentId}`,
      () => opportunityAttachmentUrlAction(o.id, attachmentId),
      (url) => {
        box.url = url;
      },
    );
    return box.url;
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {notice && (
        <div className="field-hint" style={{ color: "var(--green)", fontWeight: 600, marginBottom: 8 }}>
          {notice}
        </div>
      )}

      {/* Três colunas (pedido do usuário, 2026-10-16: "semelhante ao
          Trello"): lista de itens · conteúdo do card · comentários. A
          conversa tem coluna própria e, no modal, cada coluna rola por
          conta própria — o histórico longo do Trello não empurra mais os
          dados do card. O card de cadastro (nova/nova-card.tsx) segue em
          duas colunas: ainda não tem conversa. */}
      <div className="opp-grid com-chat">
      <div className="opp-main">
      <DetailKv />

      {tarefaAberta && <NovaTarefaNoCard />}

      {/* Histórico do card (2026-09-14): painel ligado pelo botão
          "Histórico" no rodapé, logo abaixo dos dados pra ser a primeira
          coisa que se lê ao abrir. */}
      {historicoAberto && (
        <HistoricoSection
          opportunity={o}
          activities={historico}
          memberships={memberships}
          carregando={historicoCarregando}
          erro={historicoErro}
        />
      )}

      <AttachmentsSection
        attachments={attachments}
        busy={busy}
        meUserId={me.user.id}
        canRemove={canDeleteOwn}
        canPublish={podePublicarAnexo}
        multiple
        nomeDoAutor={(userId) =>
          userId === SISTEMA_USER_ID ? "App de cotações" : memberDisplayName(userId, memberships)
        }
        onUpload={handleUpload}
        onRemove={(id) =>
          void run(
            `attach:${id}`,
            () => removeOpportunityAttachmentClientAction(o.id, id),
            (list) => setAttachments(list),
            "Anexo removido",
          )
        }
        onPublish={(id) =>
          void run(
            `publish:${id}`,
            () => publishOpportunityAttachmentClientAction(o.id, id),
            (list) => setAttachments(list),
            "Anexo publicado",
          )
        }
        getUrl={urlDoAnexo}
      />

      {/* Barra de ações no fim da coluna do conteúdo (2026-09-14): saiu
          do rodapé do modal pra não depender de rolar a conversa — que
          desde 2026-10-16 mora na coluna própria ao lado. */}
      <div className="card-acoes">
        <DetailFooter />
      </div>
      </div>

      <section className="opp-chat" aria-label="Comentários">
        <div className="drawer-section-title">Comentários{o.comments.length > 0 ? ` · ${o.comments.length}` : ""}</div>
        {/* Campo de comentário no topo da coluna (pedido do usuário,
            2026-09-15): com muitos comentários era preciso rolar a
            conversa inteira pra escrever. */}
        <form onSubmit={handleComment} className="chat-input-row chat-input-topo">
          <div className="chat-composer">
            <textarea
              name="body"
              placeholder="Escrever comentário..."
              required
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              disabled={busy !== null}
            />
            {/* Ícones da caixa, nesta ordem (pedido do usuário,
                2026-09-14): fixar · carimbar item · destacar membro. Os
                dois últimos abrem a lista de opções no clique; antes as
                duas listas ficavam sempre abertas acima do campo. */}
            <div className="composer-tools">
              <button
                type="button"
                className={fixarAoEnviar ? "composer-tool on" : "composer-tool"}
                aria-pressed={fixarAoEnviar}
                title={fixarAoEnviar ? "O comentário vai nascer fixado" : "Fixar este comentário no topo"}
                aria-label="Fixar este comentário"
                disabled={busy !== null}
                onClick={() => setFixarAoEnviar((v) => !v)}
              >
                📌
              </button>
              {items.length > 0 && (
                <button
                  type="button"
                  className={
                    painelComposer === "itens" || commentTags.length > 0 ? "composer-tool on" : "composer-tool"
                  }
                  aria-expanded={painelComposer === "itens"}
                  title="Carimbar itens no comentário"
                  aria-label="Carimbar itens no comentário"
                  disabled={busy !== null}
                  onClick={() => setPainelComposer((atual) => (atual === "itens" ? null : "itens"))}
                >
                  🛒
                  {commentTags.length > 0 && <span className="composer-tool-count">{commentTags.length}</span>}
                </button>
              )}
              {membrosParaDestacar.length > 0 && (
                <button
                  type="button"
                  className={
                    painelComposer === "membros" || commentMentions.length > 0
                      ? "composer-tool on"
                      : "composer-tool"
                  }
                  aria-expanded={painelComposer === "membros"}
                  title="Destacar membro (cria pendência pra ele)"
                  aria-label="Destacar membro"
                  disabled={busy !== null}
                  onClick={() => setPainelComposer((atual) => (atual === "membros" ? null : "membros"))}
                >
                  @
                  {commentMentions.length > 0 && (
                    <span className="composer-tool-count">{commentMentions.length}</span>
                  )}
                </button>
              )}
            </div>
            {painelComposer === "itens" && (
              <div className="composer-panel">
                <TagPicker
                  options={items.map((item) => item.name)}
                  selected={commentTags}
                  onChange={setCommentTags}
                  disabled={busy !== null}
                  hint="Carimbar itens no comentário:"
                />
              </div>
            )}
            {/* Destacar membro (2026-09-14): quem for marcado aqui vê o
                card com "Pendência(s) para você" no quadro do Pipeline até
                abrir o card e resolver. */}
            {painelComposer === "membros" && membrosParaDestacar.length > 0 && (
              <div className="composer-panel">
                <div className="tag-pick-block">
                  <div className="tag-pick-hint">Destacar membro (cria pendência pra ele):</div>
                  <div className="tag-pick-row">
                    {membrosParaDestacar.map((m) => {
                      const marcado = commentMentions.includes(m.userId);
                      return (
                        <button
                          key={m.userId}
                          type="button"
                          className={marcado ? "tag-pick on" : "tag-pick"}
                          aria-pressed={marcado}
                          disabled={busy !== null}
                          onClick={() =>
                            setCommentMentions((prev) =>
                              marcado ? prev.filter((id) => id !== m.userId) : [...prev, m.userId],
                            )
                          }
                        >
                          @{memberDisplayName(m.userId, memberships)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== null || commentText.trim() === ""}>
            {busy === "comment" ? "Enviando…" : "Enviar"}
          </button>
        </form>
        <div className="chat-thread">
          {comentarios.length > 0 ? (
            comentarios.map((c) => {
              // Mensagem espelhada de fora (hoje: comentário do cartão do
              // Trello) traz o nome de quem escreveu lá — quem comentou
              // não é membro do CRM, então o autor interno é o usuário de
              // sistema e mostrar o id dele ("00000000…") não dizia nada.
              const externo = c.externalAuthor?.trim() ?? "";
              const authorName = externo || memberDisplayName(c.authorUserId, memberships);
              const fixado = Boolean(c.pinnedAt);
              // Membros destacados no comentário (2026-09-14) e se a
              // pendência de QUEM ESTÁ LENDO ainda está de pé.
              const destacados = c.mentionedUserIds ?? [];
              const souDestacado = destacados.includes(me.user.id);
              const jaDeiBaixa = (c.mentionsDoneUserIds ?? []).includes(me.user.id);
              const minhaPendencia = souDestacado && !jaDeiBaixa;
              // Edição (2026-10-16): só o autor, e só o que foi escrito
              // aqui — mensagem do Trello se corrige no Trello e a
              // correção chega pelo espelho, também com histórico.
              const podeEditar = !externo && c.authorUserId === me.user.id;
              const versoes = c.edits ?? [];
              const editado = Boolean(c.editedAt) || versoes.length > 0;
              return (
                <div key={c.id} className="chat-msg">
                  <div className="chat-avatar">{initialsOf(authorName)}</div>
                  <div
                    className={`chat-bubble${fixado ? " fixado" : ""}${
                      minhaPendencia ? " pendente" : ""
                    }`}
                  >
                    <div className="chat-msg-head">
                      <span className="chat-author">
                        {authorName}
                        {externo ? <span className="chat-time"> · via Trello</span> : null}
                      </span>
                      {fixado && <span className="chat-pin-tag">📌 Fixado</span>}
                      {minhaPendencia && <span className="chat-pendencia-tag">⚠ Para você</span>}
                      <span className="chat-time">{formatDateTimeBR(c.createdAt)}</span>
                    </div>
                    {/* pre-wrap: o texto guarda as quebras de linha (quem
                        escreve no Trello separa cada máquina em linhas) e
                        sem isso o navegador emendava tudo. */}
                    {editandoTexto === c.id ? (
                      <div className="chat-edit">
                        <textarea
                          value={rascunho}
                          onChange={(e) => setRascunho(e.target.value)}
                          onKeyDown={(e) => {
                            // Esc fecha só a edição — sem isso ele subia
                            // até o modal e fechava o card inteiro.
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setEditandoTexto(null);
                            }
                          }}
                          rows={Math.min(12, Math.max(3, rascunho.split("\n").length + 1))}
                          disabled={busy !== null}
                          aria-label="Editar comentário"
                          autoFocus
                        />
                        <div className="chat-edit-acoes">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy !== null}
                            onClick={() => setEditandoTexto(null)}
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy !== null || rascunho.trim() === "" || rascunho.trim() === c.body}
                            onClick={() => salvarEdicao(c.id)}
                          >
                            {busy === `editar:${c.id}` ? "Salvando…" : "Salvar"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="chat-text" style={{ whiteSpace: "pre-wrap" }}>
                        {externo ? <TextoTrello texto={c.body} /> : c.body}
                      </div>
                    )}
                    {/* "(editado)" abre as versões anteriores — o texto
                        nunca se perde (histórico gravado pelo backend). */}
                    {editado && (
                      <button
                        type="button"
                        className="chat-editado"
                        aria-expanded={versoesDe === c.id}
                        title="Ver o texto antes de cada edição"
                        onClick={() => setVersoesDe((atual) => (atual === c.id ? null : c.id))}
                      >
                        {versoesDe === c.id ? "(editado · ocultar versões)" : "(editado · ver versões)"}
                      </button>
                    )}
                    {versoesDe === c.id && (
                      <div className="chat-versoes">
                        {versoes.length > 0 ? (
                          [...versoes].reverse().map((v) => (
                            <div key={v.id} className="chat-versao">
                              <div className="chat-versao-quando">
                                Texto até {formatDateTimeBR(v.editedAt)} —{" "}
                                {externo
                                  ? "corrigido no Trello"
                                  : `editado por ${memberDisplayName(v.editedByUserId, memberships)}`}
                              </div>
                              <div className="chat-versao-texto">
                                {externo ? <TextoTrello texto={v.bodyBefore} /> : v.bodyBefore}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="chat-versao-quando">Feche e abra o card para ver as versões.</div>
                        )}
                      </div>
                    )}
                    {destacados.length > 0 && (
                      <div className="tag-stamp-row">
                        {destacados.map((userId) => (
                          <span
                            key={userId}
                            className={
                              (c.mentionsDoneUserIds ?? []).includes(userId)
                                ? "mencao-chip resolvida"
                                : "mencao-chip"
                            }
                            title={
                              (c.mentionsDoneUserIds ?? []).includes(userId)
                                ? "Pendência resolvida"
                                : "Pendência em aberto"
                            }
                          >
                            @{memberDisplayName(userId, memberships)}
                          </span>
                        ))}
                      </div>
                    )}
                    <TagChips tags={c.tags ?? []} />
                    {/* Destacar membro depois do comentário publicado
                        (2026-09-14): o painel abre pelo botão "Destacar
                        membro" e cada clique já grava. */}
                    {editandoDestaques === c.id && (
                      <div className="tag-pick-block">
                        <div className="tag-pick-hint">Quem tem pendência neste comentário:</div>
                        <div className="tag-pick-row">
                          {membrosParaDestacar.map((m) => {
                            const marcado = destacados.includes(m.userId);
                            return (
                              <button
                                key={m.userId}
                                type="button"
                                className={marcado ? "tag-pick on" : "tag-pick"}
                                aria-pressed={marcado}
                                disabled={busy !== null}
                                onClick={() => alternarDestaque(c.id, destacados, m.userId)}
                              >
                                @{memberDisplayName(m.userId, memberships)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="chat-msg-actions">
                      {podeEditar && editandoTexto !== c.id && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: 0 }}
                          disabled={busy !== null}
                          onClick={() => {
                            setEditandoTexto(c.id);
                            setRascunho(c.body);
                          }}
                        >
                          ✎ Editar
                        </button>
                      )}
                      {/* Baixa da pendência (2026-09-14): só aparece pra
                          quem foi destacado. É o que apaga o triângulo
                          amarelo do card no quadro — pra essa pessoa. */}
                      {souDestacado && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: 0, fontWeight: 700 }}
                          disabled={busy !== null}
                          onClick={() =>
                            void run(
                              `pendencia:${c.id}`,
                              () => setOpportunityMentionDoneAction(o.id, c.id, !jaDeiBaixa),
                              (saved) =>
                                setOpportunity((prev) => ({
                                  ...prev,
                                  comments: trocarComentario(prev.comments, saved),
                                })),
                              jaDeiBaixa ? "Pendência reaberta" : "Pendência resolvida",
                            )
                          }
                        >
                          {busy === `pendencia:${c.id}`
                            ? "Salvando…"
                            : jaDeiBaixa
                              ? "Reabrir pendência"
                              : "✓ Resolver pendência"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: 0 }}
                        disabled={busy !== null}
                        onClick={() =>
                          setEditandoDestaques((atual) => (atual === c.id ? null : c.id))
                        }
                      >
                        {busy === `destaque:${c.id}`
                          ? "Salvando…"
                          : editandoDestaques === c.id
                            ? "Fechar destaques"
                            : "@ Destacar membro"}
                      </button>
                      {/* Fixar (2026-09-09): marca colaborativa — qualquer
                          um que enxerga o card pode fixar, não só o autor.
                          O fixado abre no topo do histórico de anotações
                          do Pipeline. */}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: 0 }}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            `pin:${c.id}`,
                            () => setOpportunityCommentPinnedAction(o.id, c.id, !fixado),
                            (saved) =>
                              setOpportunity((prev) => ({
                                ...prev,
                                comments: trocarComentario(prev.comments, saved),
                              })),
                            fixado ? "Comentário desafixado" : "Comentário fixado",
                          )
                        }
                      >
                        {busy === `pin:${c.id}`
                          ? "Salvando…"
                          : fixado
                            ? "Desafixar"
                            : "📌 Fixar"}
                      </button>
                      {c.authorUserId === me.user.id && canDeleteOwn && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: 0 }}
                          disabled={busy !== null}
                          onClick={() =>
                            void run(
                              `comment:${c.id}`,
                              () => removeOpportunityCommentAction(o.id, c.id),
                              () =>
                                setOpportunity((prev) => ({
                                  ...prev,
                                  comments: prev.comments.filter((x) => x.id !== c.id),
                                })),
                            )
                          }
                        >
                          {busy === `comment:${c.id}` ? "Removendo…" : "Remover"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="chat-empty">Nenhum comentário ainda. Registre o andamento da negociação.</div>
          )}
        </div>
      </section>

      <aside className="opp-side">
        <ItemsPanel
          items={items.map((item) => ({
            key: item.id,
            name: item.name,
            amount: item.amount === null ? null : Number(item.amount),
          }))}
          onAdd={addItem}
          onRemove={(item) => removeItem(item.key)}
          onChangeAmount={(item, amount) => setItemAmount(item.key, amount)}
          busyKey={busy === "item" ? "add" : busy?.startsWith("item:") ? busy.slice("item:".length) : null}
          disabled={busy !== null}
          canEdit={canEditItems}
          totalizador={<ValorTotalizador />}
        />
      </aside>
      </div>
    </>
  );
}

// Formulário de tarefa nova aberto dentro do card (2026-10-29), já
// vinculado à oportunidade. Contatos e responsáveis vêm só na abertura.
function NovaTarefaNoCard() {
  const { data, opportunity: o, items, setTarefaAberta, tarefaCriada } = useOpportunityDetail();
  const [contexto, setContexto] = useState<{ contacts: Contact[]; assigneeOptions: AssigneeOption[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    void novaTarefaContextoAction(data.company.id)
      .then((res) => {
        if (cancelado) return;
        if (res.ok) setContexto(res.data);
        else setErro(res.message);
      })
      .catch(() => !cancelado && setErro("Não deu pra abrir o formulário. Tente de novo."));
    return () => {
      cancelado = true;
    };
  }, [data.company.id]);

  return (
    <section className="task-detail-section opp-nova-tarefa">
      <div className="drawer-section-title">Nova tarefa</div>
      {erro ? (
        <div className="error-banner">{erro}</div>
      ) : !contexto ? (
        <div className="field-hint">Carregando…</div>
      ) : (
        <NovaForm
          lockedOpportunityId={o.id}
          lockedLabel="Vinculada a esta oportunidade"
          initialContacts={contexto.contacts}
          initialCompanyId={data.company.id}
          assigneeOptions={contexto.assigneeOptions}
          opportunityItems={items.map((item) => item.name)}
          onCreated={tarefaCriada}
          onCancel={() => setTarefaAberta(false)}
        />
      )}
    </section>
  );
}

// "Mais ações" (pedido do usuário, 2026-09-15): desfecho, tarefa e
// histórico saíram da barra de botões — sete botões lado a lado ficavam
// espremidos — e foram pra um menu na linha do nome da empresa, alinhado
// à direita. Continuam longe do "Salvar" pelo mesmo motivo da ficha de
// tarefa (2026-09-04): botão que muda a situação colado no de salvar faz
// encerrar a oportunidade quem só queria corrigir um campo.
function MaisAcoes() {
  const {
    data,
    opportunity: o,
    busy,
    error,
    setStatus,
    setStandby,
    historicoAberto,
    toggleHistorico,
    setTarefaAberta,
  } = useOpportunityDetail();
  const [aberto, setAberto] = useState(false);
  const [perguntaPerda, setPerguntaPerda] = useState(false);
  const [perguntaStandby, setPerguntaStandby] = useState(false);
  // setStatus fecha o card quando dá certo; se falhar, o erro aparece no
  // card e o modal de motivo sai da frente pra ele ficar visível.
  useEffect(() => {
    if (error) {
      setPerguntaPerda(false);
      setPerguntaStandby(false);
    }
  }, [error]);
  const emStandby = Boolean(o.standbyAt);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { stage, maxOrder } = data;
  const closed = o.status !== "open";
  const canClose = o.status === "open" && stage && stage.order === maxOrder;
  const disabled = busy !== null;

  // Fecha ao clicar fora ou no Esc — mesmo molde do dropdown de importar
  // planilha (leads/import-contacts-toggle.tsx). O Esc é tratado em fase
  // de captura pra não fechar o card inteiro junto com o menu.
  useEffect(() => {
    if (!aberto) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setAberto(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAberto(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [aberto]);

  return (
    <div className="mais-acoes" ref={wrapperRef}>
      <button
        type="button"
        className="btn btn-sm"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        {busy === "status"
          ? closed
            ? "Reabrindo…"
            : "Fechando…"
          : busy === "standby"
            ? "Salvando…"
            : "Mais ações"}
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {aberto && (
        <div className="mais-acoes-menu" role="menu" onClick={() => setAberto(false)}>
          {canClose && (
            <>
              <button
                type="button"
                role="menuitem"
                className="mais-acoes-item sucesso"
                disabled={disabled}
                onClick={() => setStatus("won", "🎉 Oportunidade fechada!")}
              >
                ✓ Marcar Fechada
              </button>
              <button
                type="button"
                role="menuitem"
                className="mais-acoes-item perigo"
                disabled={disabled}
                onClick={() => setPerguntaPerda(true)}
              >
                ✕ Marcar Perdida
              </button>
            </>
          )}
          {closed && (
            <button
              type="button"
              role="menuitem"
              className="mais-acoes-item"
              disabled={disabled}
              onClick={() => setStatus("open", "Oportunidade reaberta")}
            >
              ↩ Reabrir
            </button>
          )}
          {/* Stand by (pedido do usuário, 2026-10-22): o cliente avaliou e
              vai retomar mais adiante. Sai do quadro e volta pelo
              calendário na nova previsão de fechamento. */}
          {!closed && !emStandby && (
            <button
              type="button"
              role="menuitem"
              className="mais-acoes-item"
              disabled={disabled}
              onClick={() => setPerguntaStandby(true)}
            >
              ⏸ Colocar em Stand by
            </button>
          )}
          {!closed && emStandby && (
            <button
              type="button"
              role="menuitem"
              className="mais-acoes-item"
              disabled={disabled}
              onClick={() => void setStandby(false)}
            >
              ▶ Retomar negociação
            </button>
          )}
          {/* Gerar tarefa (2026-10-29): também no card encerrado — lembrete
              pra retomar uma perdida — e dentro do próprio card, sem abrir
              outra janela. */}
          <button type="button" role="menuitem" className="mais-acoes-item" onClick={() => setTarefaAberta(true)}>
            + Gerar tarefa
          </button>
          {/* Histórico (2026-09-14): liga/desliga o relatório de
              movimentações do card — trocas de etapa, edições de campo e
              mexidas na lista de itens, com data, hora e autor. */}
          <button type="button" role="menuitem" className="mais-acoes-item" onClick={toggleHistorico}>
            {historicoAberto ? "Ocultar histórico" : "Histórico"}
          </button>
        </div>
      )}
      {perguntaPerda && (
        <MotivoPerdaModal
          enviando={busy === "status"}
          onCancelar={() => setPerguntaPerda(false)}
          onEscolher={(motivo) => void setStatus("lost", "Oportunidade marcada como perdida", motivo)}
        />
      )}
      {perguntaStandby && (
        <StandbyModal
          previsaoAtual={o.expectedCloseDate ? formatDateOnlyBR(o.expectedCloseDate) : null}
          enviando={busy === "standby"}
          onCancelar={() => setPerguntaStandby(false)}
          onConfirmar={(dayKey) => void setStandby(true, dayKey)}
        />
      )}
    </div>
  );
}

// Rodapé: só Excluir à esquerda e Fechar/Salvar à direita. O resto mora
// em "Mais ações" (acima).
export function DetailFooter() {
  const { data, opportunity: o, busy, isModal, remove, close } = useOpportunityDetail();
  const closed = o.status !== "open";
  // Representante não exclui nenhum tipo de registro (pedido do usuário,
  // 2026-08-06, ver PolicyService#can).
  const canDelete = data.me.membership.role !== "sales_rep";
  const disabled = busy !== null;

  return (
    <div className="card-acoes-linha">
      <div className="card-acoes-grupo">
        {canDelete && (
          <button type="button" className="btn btn-danger" disabled={disabled} onClick={() => void remove()}>
            {busy === "delete" ? "Excluindo…" : "Excluir"}
          </button>
        )}
      </div>
      <div className="card-acoes-grupo">
        {isModal ? (
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy === "delete"}>
            Fechar
          </button>
        ) : (
          <Link href="/dashboard/pipeline" className="btn btn-ghost">
            Fechar
          </Link>
        )}
        {!closed && (
          <button type="submit" form={EDIT_FORM_ID} className="btn btn-primary" disabled={disabled}>
            {busy === "save" ? "Salvando…" : "Salvar"}
          </button>
        )}
      </div>
    </div>
  );
}
