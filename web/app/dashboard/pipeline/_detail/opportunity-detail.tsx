"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useContext, useEffect, useRef, useState } from "react";
import { companyRazaoSocialName } from "@/lib/api/companies";
import type { Activity, Membership, OpportunityItem, OpportunityWithDetails } from "@/lib/api/types";
import type { OpportunityAttachment } from "@/lib/api/opportunity-attachments";
import { formatDateBR, formatDateTimeBR } from "@/lib/format-date";
import { REFRESH_SESSION_KEY, TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { AttachmentsSection } from "@/app/dashboard/_overlay/attachments";
import type { OpportunityDetail } from "./load";
import MotivoPerdaModal from "./motivo-perda-modal";
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
  setOpportunityStatusAction,
} from "../actions";
import { ItemsPanel, TagChips, TagPicker } from "./item-tags";
import HistoricoSection from "./historico";
import { enviarAnexosOportunidade } from "./enviar-anexos";

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
  | "save"
  | "delete"
  | "comment"
  | "upload"
  | `comment:${string}`
  | `pin:${string}`
  | `pendencia:${string}`
  | `destaque:${string}`
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
    if (busy) return;
    setBusy("status");
    setError(null);
    try {
      const res = await setOpportunityStatusAction(opportunity.id, opportunity.version, status, lostReason);
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
        remove,
        close,
        historicoAberto,
        historico,
        historicoErro,
        historicoCarregando,
        toggleHistorico,
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



function memberDisplayName(userId: string, memberships: Membership[]): string {
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || `${userId.slice(0, 8)}…`;
}

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
function DetailKv() {
  const { data, opportunity: o, items, busy, setOpportunity, run } = useOpportunityDetail();
  const { company } = data;
  const closed = o.status !== "open";
  // Valor da oportunidade quando os itens têm preço: quem manda é a
  // soma (o backend grava, ver OpportunityItemService#sincronizarValor),
  // então o campo vira leitura pra não existirem dois números brigando
  // na mesma tela.
  const somaItens = items.reduce(
    (total, item) => (item.amount === null ? total : total + Number(item.amount)),
    0,
  );
  const valorVemDosItens = items.some((item) => item.amount !== null);
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
          <span>{companyRazaoSocialName(company)}</span>
          <MaisAcoes />
        </dd>
        <dt>Representante</dt>
        <dd>{memberDisplayName(o.ownerUserId, data.memberships)}</dd>
        <dt>Valor</dt>
        <dd style={{ fontFamily: "var(--font-mono)", color: "var(--accent-secondary)", fontWeight: 600 }}>
          {brlFull(Number(o.amount), o.currency)}
        </dd>
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
          <span>{companyRazaoSocialName(company)}</span>
          <MaisAcoes />
        </dd>
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
        <label>
          Valor
          {valorVemDosItens ? (
            <input
              name="amount-somado"
              value={somaItens.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              readOnly
              title="Soma dos itens da lista ao lado"
            />
          ) : (
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={o.amount}
              disabled={busy !== null}
            />
          )}
        </label>
        {/* Moeda saiu do card (pedido do usuário, 2026-09-11): tudo é
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
          comments: prev.comments.map((x) => (x.id === saved.id ? saved : x)),
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
          comments: prev.comments.map((x) => (x.id === saved.id ? saved : x)),
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

      {/* Duas colunas (2026-09-04): conteúdo do card + lista lateral de
          itens — mesmo layout do card de cadastro (nova/nova-card.tsx). */}
      <div className="opp-grid">
      <div className="opp-main">
      <DetailKv />

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
        nomeDoAutor={(userId) => memberDisplayName(userId, memberships)}
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

      {/* Barra de ações no meio do card (pedido do usuário, 2026-09-14):
          antes ficava no rodapé do modal, e com o histórico de comentários
          longo era preciso rolar até o fim só pra Fechar ou Salvar. */}
      <div className="card-acoes">
        <DetailFooter />
      </div>

      <div className="task-detail-section">
        <div className="drawer-section-title">Comentários{o.comments.length > 0 ? ` · ${o.comments.length}` : ""}</div>
        {/* Campo de comentário no topo da seção, logo abaixo da barra de
            botões (pedido do usuário, 2026-09-15): com muitos comentários
            era preciso rolar a conversa inteira pra escrever. */}
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
                    <div className="chat-text">{c.body}</div>
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
                                  comments: prev.comments.map((x) => (x.id === saved.id ? saved : x)),
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
                                comments: prev.comments.map((x) => (x.id === saved.id ? saved : x)),
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
      </div>
      </div>

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
        />
      </aside>
      </div>
    </>
  );
}

// "Mais ações" (pedido do usuário, 2026-09-15): desfecho, tarefa e
// histórico saíram da barra de botões — sete botões lado a lado ficavam
// espremidos — e foram pra um menu na linha do nome da empresa, alinhado
// à direita. Continuam longe do "Salvar" pelo mesmo motivo da ficha de
// tarefa (2026-09-04): botão que muda a situação colado no de salvar faz
// encerrar a oportunidade quem só queria corrigir um campo.
function MaisAcoes() {
  const { data, opportunity: o, busy, error, setStatus, historicoAberto, toggleHistorico } = useOpportunityDetail();
  const [aberto, setAberto] = useState(false);
  const [perguntaPerda, setPerguntaPerda] = useState(false);
  // setStatus fecha o card quando dá certo; se falhar, o erro aparece no
  // card e o modal de motivo sai da frente pra ele ficar visível.
  useEffect(() => {
    if (error) setPerguntaPerda(false);
  }, [error]);
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
        {busy === "status" ? (closed ? "Reabrindo…" : "Fechando…") : "Mais ações"}
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
          {!closed && (
            <Link href={`/dashboard/pipeline/${o.id}/nova-tarefa`} role="menuitem" className="mais-acoes-item">
              + Gerar tarefa
            </Link>
          )}
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
