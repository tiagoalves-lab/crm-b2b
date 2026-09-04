"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { companyDisplayName } from "@/lib/api/companies";
import type { Membership, OpportunityItem, OpportunityWithDetails } from "@/lib/api/types";
import type { OpportunityAttachment } from "@/lib/api/opportunity-attachments";
import { formatDateBR, formatDateTimeBR } from "@/lib/format-date";
import { REFRESH_SESSION_KEY, TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { AttachmentsSection } from "@/app/dashboard/_overlay/attachments";
import type { OpportunityDetail } from "./load";
import {
  addOpportunityCommentAction,
  addOpportunityItemAction,
  deleteOpportunityClientAction,
  opportunityAttachmentUrlAction,
  removeOpportunityAttachmentClientAction,
  removeOpportunityCommentAction,
  removeOpportunityItemAction,
  saveOpportunityDetailAction,
  setOpportunityItemAmountAction,
  setOpportunityStatusAction,
  uploadOpportunityAttachmentClientAction,
} from "../actions";
import { ItemsPanel, TagChips, TagPicker } from "./item-tags";

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
  | `attach:${string}`
  | `download:${string}`
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
  setStatus: (status: "won" | "open", noticeText: string) => Promise<void>;
  remove: () => Promise<void>;
  close: () => void;
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

  // Mesmo fluxo de Concluir/Reabrir da ficha de tarefa (task-detail.tsx,
  // 2026-09-04): a mudança de status fecha o card e o resultado aparece
  // no quadro (card na coluna certa + toast), em vez de trocar o botão
  // pelo oposto no mesmo lugar com o quadro de trás ainda desatualizado.
  async function setStatus(status: "won" | "open", noticeText: string) {
    if (busy) return;
    setBusy("status");
    setError(null);
    try {
      const res = await setOpportunityStatusAction(opportunity.id, opportunity.version, status);
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
  // Só membro ativo pode receber a oportunidade (o backend recusa o
  // resto — assertActiveMembership). O dono atual entra na lista mesmo se
  // já estiver inativo, senão o select abriria em outro nome e o próximo
  // "Salvar" trocaria o representante sem ninguém pedir.
  const responsaveis = data.memberships.filter((m) => m.status === "active" || m.userId === o.ownerUserId);

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
          currency: campo("currency") ?? o.currency,
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
        <dd>{companyDisplayName(company)}</dd>
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
        <dd>{companyDisplayName(company)}</dd>
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
          {valorVemDosItens && <span className="field-hint">Soma dos itens</span>}
        </label>
        <label>
          Moeda
          <input name="currency" maxLength={3} defaultValue={o.currency} disabled={busy !== null} />
        </label>
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
  } = useOpportunityDetail();
  const { me, memberships } = data;
  const [commentText, setCommentText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Itens escolhidos pra carimbar no próximo comentário (2026-09-04).
  const [commentTags, setCommentTags] = useState<string[]>([]);
  const canDeleteOwn = me.membership.role !== "sales_rep";
  // A lista de itens só muda com a oportunidade aberta — encerrada, fica
  // como registro (mesma regra dos botões Editar/Gerar tarefa no rodapé).
  const canEditItems = o.status === "open";

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
  function handleUpload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    void run(
      "upload",
      () => uploadOpportunityAttachmentClientAction(o.id, fd),
      (list) => setAttachments(list),
      "Anexo adicionado",
    );
  }

  function handleComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentText.trim();
    if (!body) return;
    void run(
      "comment",
      () => addOpportunityCommentAction(o.id, body, commentTags),
      (comment) => {
        setOpportunity((prev) => ({ ...prev, comments: [...prev.comments, comment] }));
        setCommentText("");
        setCommentTags([]);
      },
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

      <AttachmentsSection
        attachments={attachments}
        busy={busy}
        meUserId={me.user.id}
        canRemove={canDeleteOwn}
        onUpload={handleUpload}
        onRemove={(id) =>
          void run(
            `attach:${id}`,
            () => removeOpportunityAttachmentClientAction(o.id, id),
            (list) => setAttachments(list),
            "Anexo removido",
          )
        }
        getUrl={urlDoAnexo}
      />

      <div className="task-detail-section">
        <div className="drawer-section-title">Comentários{o.comments.length > 0 ? ` · ${o.comments.length}` : ""}</div>
        <div className="chat-thread">
          {o.comments.length > 0 ? (
            o.comments.map((c) => {
              // Mensagem espelhada de fora (hoje: comentário do cartão do
              // Trello) traz o nome de quem escreveu lá — quem comentou
              // não é membro do CRM, então o autor interno é o usuário de
              // sistema e mostrar o id dele ("00000000…") não dizia nada.
              const externo = c.externalAuthor?.trim() ?? "";
              const authorName = externo || memberDisplayName(c.authorUserId, memberships);
              return (
                <div key={c.id} className="chat-msg">
                  <div className="chat-avatar">{initialsOf(authorName)}</div>
                  <div className="chat-bubble">
                    <div className="chat-msg-head">
                      <span className="chat-author">
                        {authorName}
                        {externo ? <span className="chat-time"> · via Trello</span> : null}
                      </span>
                      <span className="chat-time">{formatDateTimeBR(c.createdAt)}</span>
                    </div>
                    <div className="chat-text">{c.body}</div>
                    <TagChips tags={c.tags ?? []} />
                    {c.authorUserId === me.user.id && canDeleteOwn && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: 0, marginTop: 4 }}
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
              );
            })
          ) : (
            <div className="chat-empty">Nenhum comentário ainda. Registre o andamento da negociação.</div>
          )}
        </div>
        <TagPicker
          options={items.map((item) => item.name)}
          selected={commentTags}
          onChange={setCommentTags}
          disabled={busy !== null}
          hint="Carimbar itens no comentário:"
        />
        <form onSubmit={handleComment} className="chat-input-row">
          <textarea
            name="body"
            placeholder="Escrever comentário..."
            required
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={busy !== null}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== null || commentText.trim() === ""}>
            {busy === "comment" ? "Enviando…" : "Enviar"}
          </button>
        </form>
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

// Rodapé (protótipo: botões de openDealDetail — Excluir/Fechar +
// Ganhar/Perder só no último estágio, Reabrir se já encerrada). Ganhou
// "Gerar tarefa" (feature nova) e, em 2026-09-04, o "Salvar" do
// formulário que o card virou — o "Editar" que abria outra tela foi
// apagado no mesmo dia.
export function DetailFooter() {
  const { data, opportunity: o, busy, isModal, setStatus, remove, close } = useOpportunityDetail();
  const { stage, maxOrder, me } = data;
  const closed = o.status !== "open";
  const canClose = o.status === "open" && stage && stage.order === maxOrder;
  // Representante não exclui nenhum tipo de registro (pedido do usuário,
  // 2026-08-06, ver PolicyService#can).
  const canDelete = me.membership.role !== "sales_rep";
  const disabled = busy !== null;

  return (
    <>
      {/* Desfecho (Fechada/Perdida/Reabrir) na ponta esquerda, separado do
          "Salvar" — mesmo motivo da ficha de tarefa (2026-09-04): botão que
          muda a situação colado no de salvar faz encerrar a oportunidade
          quem só queria corrigir um campo. */}
      {canClose && (
        <>
          <button
            type="button"
            className="btn btn-success"
            disabled={disabled}
            onClick={() => setStatus("won", "🎉 Oportunidade fechada!")}
          >
            {busy === "status" ? "Fechando…" : "✓ Marcar Fechada"}
          </button>
          <Link
            href={`/dashboard/pipeline/${o.id}/perder`}
            className="btn btn-danger"
            style={{ marginRight: "auto" }}
          >
            ✕ Marcar Perdida
          </Link>
        </>
      )}
      {closed && (
        <button
          type="button"
          className="btn"
          style={{ marginRight: "auto" }}
          disabled={disabled}
          onClick={() => setStatus("open", "Oportunidade reaberta")}
        >
          {busy === "status" ? "Reabrindo…" : "↩ Reabrir"}
        </button>
      )}
      {canDelete && (
        <button type="button" className="btn btn-danger" disabled={disabled} onClick={() => void remove()}>
          {busy === "delete" ? "Excluindo…" : "Excluir"}
        </button>
      )}
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
        <Link href={`/dashboard/pipeline/${o.id}/nova-tarefa`} className="btn">
          + Gerar tarefa
        </Link>
      )}
      {!closed && (
        <button type="submit" form={EDIT_FORM_ID} className="btn btn-primary" disabled={disabled}>
          {busy === "save" ? "Salvando…" : "Salvar"}
        </button>
      )}
    </>
  );
}
