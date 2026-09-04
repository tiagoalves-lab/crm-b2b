"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Membership, TaskStatus, TaskWithDetails } from "@/lib/api/types";
import type { TaskAttachment } from "@/lib/api/task-attachments";
import type { UpdateTaskInput } from "@/lib/api/tasks";
import { formatDateTimeBR } from "@/lib/format-date";
import { REFRESH_SESSION_KEY, TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { AttachmentsSection } from "@/app/dashboard/_overlay/attachments";
import type { TaskDetail } from "./load";
import TipoContatoFields from "../tipo-contato-fields";
import { TagPicker } from "../../pipeline/_detail/item-tags";
import {
  addTaskCommentAction,
  attachmentDownloadUrlAction,
  deleteTaskClientAction,
  removeTaskAttachmentAction,
  removeTaskCommentAction,
  saveTaskDetailAction,
  setTaskStatusAction,
  uploadTaskAttachmentAction,
} from "../actions";

// Ficha da tarefa (modal interceptado e página cheia) — client component
// desde 2026-09-03. Antes cada botão era um <form action> com
// revalidatePath()+redirect(), e dentro do @modal o Next deixava o botão
// em "Concluindo…" pra sempre (diagnóstico do dia: o servidor concluía em
// 0,3 s, o navegador nunca aplicava o redirect). Agora:
//
// - cada ação devolve o resultado e a ficha atualiza o próprio estado na
//   hora (pill, botão, comentários, anexos);
// - um refresh em segundo plano (useRefresh, _overlay/refresh.ts) põe a
//   lista atrás e a ficha em dia com o servidor, sem bloquear nada — e
//   sobrevive ao usuário fechar o modal antes de ele chegar;
// - Concluir/Reabrir fecham a ficha depois que o refresh chega e o
//   resultado aparece na lista (setStatus, 2026-09-04);
// - erro vira faixa vermelha dentro da ficha, nunca redirect com ?error=.
//
// Body e Footer são componentes separados (o OverlayModal recebe o rodapé
// por prop), por isso o estado mora num contexto — TaskDetailProvider
// envolve os dois nas duas páginas que usam a ficha.

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
  | null;

interface TaskDetailState {
  data: TaskDetail;
  task: TaskWithDetails;
  attachments: TaskAttachment[];
  busy: Busy;
  error: string | null;
  notice: string | null;
  isModal: boolean;
  setTask: (updater: (prev: TaskWithDetails) => TaskWithDetails) => void;
  setAttachments: (list: TaskAttachment[]) => void;
  run: <T>(key: Busy, fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void, notice?: string) => Promise<void>;
  setStatus: (status: TaskStatus, noticeText: string) => Promise<void>;
  remove: () => Promise<void>;
  close: () => void;
}

const TaskDetailContext = createContext<TaskDetailState | null>(null);

// Teto de espera pelo refresh antes de fechar a ficha depois de
// Concluir/Reabrir (normalmente chega em ~1 s).
const FECHAR_EM_MS = 5000;

function useTaskDetail(): TaskDetailState {
  const ctx = useContext(TaskDetailContext);
  if (!ctx) throw new Error("useTaskDetail fora de TaskDetailProvider");
  return ctx;
}

export function TaskDetailProvider({
  data,
  isModal,
  children,
}: {
  data: TaskDetail;
  isModal: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [task, setTaskState] = useState<TaskWithDetails>(data.task);
  const [attachments, setAttachments] = useState<TaskAttachment[]>(data.attachments);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useRefresh();
  // Concluir/Reabrir fecham a ficha (ver setStatus): só depois que o
  // refresh chegou — a lista de trás recarrega junto — ou, se ele
  // demorar mais que FECHAR_EM_MS, fecha assim mesmo com a marca de
  // refresh pendente de pé (o Toast refresca ao chegar na lista).
  const closeWhenFresh = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Depois de um refresh o servidor manda a ficha de novo — o
  // estado local acompanha (o que o usuário ainda está digitando nos
  // campos não se perde: são inputs não-controlados, defaultValue).
  useEffect(() => {
    setTaskState(data.task);
    setAttachments(data.attachments);
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

  const setTask = (updater: (prev: TaskWithDetails) => TaskWithDetails) => setTaskState((prev) => updater(prev));

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
    else router.push("/dashboard/tarefas");
  }

  // Concluir e Reabrir fecham a ficha e o resultado aparece na lista
  // (linha atualizada + toast). Até 2026-09-04 o botão virava o oposto no
  // mesmo lugar ("Reabrir" → "Concluir") com a lista de trás ainda no
  // estado antigo; o histórico do banco mostra "reabrir" seguido de
  // "concluir" segundos depois, três vezes no mesmo dia — o segundo
  // clique desfazia o primeiro e o usuário via "não reabre". Agora:
  // action → refresh (lista atrás recarrega junto) → quando a resposta
  // chega, a ficha fecha (efeito em [data]). O botão fica em
  // "Reabrindo…"/"Concluindo…" até lá — sem segundo clique possível.
  async function setStatus(status: TaskStatus, noticeText: string) {
    if (busy) return;
    setBusy("status");
    setError(null);
    try {
      const res = await setTaskStatusAction(task.id, status);
      if (!res.ok) {
        setError(res.message);
        setBusy(null);
        return;
      }
      setTaskState((prev) => ({ ...prev, ...res.data }));
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
    if (!window.confirm(`Excluir a tarefa "${task.title}"? Não dá pra desfazer.`)) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await deleteTaskClientAction(task.id);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      // A lista atrás ainda mostra a tarefa: o Toast (montado no layout,
      // sobrevive ao fechamento do modal) lê esta chave ao chegar na
      // lista e dispara um router.refresh() — refresh daqui de dentro
      // re-renderizaria a URL da tarefa que acabou de sumir (404).
      sessionStorage.setItem(TOAST_SESSION_KEY, "Tarefa excluída");
      sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <TaskDetailContext.Provider
      value={{ data, task, attachments, busy, error, notice, isModal, setTask, setAttachments, run, setStatus, remove, close }}
    >
      {children}
    </TaskDetailContext.Provider>
  );
}

// Único form de edição da tarefa (título/descrição/tipo/prazo/
// responsável) — o botão "Salvar" mora no rodapé do modal (DetailFooter,
// fora da árvore deste <form>), por isso o atributo form= referenciando
// esse id (associação padrão do HTML; o submit dispara o onSubmit do form).
const EDIT_FORM_ID = "task-edit-form";


// Nome de exibição do autor — sempre o nome/login real do membro (GET
// /memberships vem enriquecido a partir do Supabase Auth), nunca "Você".
function memberDisplayName(userId: string, memberships: Membership[]): string {
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || `${userId.slice(0, 8)}…`;
}

function initialsOf(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function DetailBody() {
  const { data, task, attachments, busy, error, notice, setTask, setAttachments, run } = useTaskDetail();
  const { targetLabel, me, memberships, contacts, companyId, opportunityItems } = data;
  const [commentText, setCommentText] = useState("");
  // Carimbo de itens da oportunidade (2026-09-04). As opções são os itens
  // atuais da oportunidade mais qualquer tag já gravada na tarefa (item
  // que saiu da lista continua visível aqui, pra poder ser desmarcado).
  const [tags, setTags] = useState<string[]>(task.tags ?? []);
  const tagOptions = Array.from(new Set([...(opportunityItems ?? []), ...(task.tags ?? [])]));
  const canDeleteOwn = me.membership.role !== "sales_rep";

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const campo = (name: string) => {
      const v = fd.get(name);
      return typeof v === "string" ? v : undefined;
    };
    void run(
      "save",
      () =>
        saveTaskDetailAction(task.id, {
          title: campo("title"),
          description: campo("description") ?? "",
          dueAt: campo("dueAt"),
          tipo: campo("tipo") as UpdateTaskInput["tipo"],
          contactId: campo("contactId"),
          assigneeUserId: campo("assigneeUserId"),
          tags: tagOptions.length > 0 ? fd.getAll("tags").filter((t): t is string => typeof t === "string") : undefined,
        }),
      (saved) => setTask((prev) => ({ ...prev, ...saved })),
      "Tarefa atualizada",
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
      () => uploadTaskAttachmentAction(task.id, fd),
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
      () => addTaskCommentAction(task.id, body),
      (comment) => {
        setTask((prev) => ({ ...prev, comments: [...prev.comments, comment] }));
        setCommentText("");
      },
    );
  }

  // URL assinada e temporária do arquivo, gerada só no clique. Quem
  // exibe é a prévia do AttachmentsSection.
  async function urlDoAnexo(attachmentId: string): Promise<string | null> {
    const box: { url: string | null } = { url: null };
    await run(
      `download:${attachmentId}`,
      () => attachmentDownloadUrlAction(task.id, attachmentId),
      (url) => {
        box.url = url;
      },
    );
    return box.url;
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div
        className="row-form"
        style={{ marginBottom: 12, justifyContent: "space-between", alignItems: "center" }}
      >
        <div className="row-form" style={{ alignItems: "center", gap: 10 }}>
          <span className={task.status === "done" ? "pill pill-green" : "pill pill-gray"}>
            {task.status === "done" ? "Concluída" : "Pendente"}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{targetLabel}</span>
          {notice && (
            <span className="field-hint" style={{ marginTop: 0, color: "var(--green)", fontWeight: 600 }}>
              {notice}
            </span>
          )}
        </div>
        <span className="field-hint" style={{ marginTop: 0 }}>
          Inserido por {memberDisplayName(task.createdBy, memberships)}
        </span>
      </div>

      <form id={EDIT_FORM_ID} onSubmit={handleSave} className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>
          Título
          <input name="title" defaultValue={task.title} required />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Descrição
          <textarea name="description" defaultValue={task.description ?? ""} rows={3} />
        </label>
        {tagOptions.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="field" style={{ marginBottom: 6 }}>
              <label>Itens da oportunidade (carimbados na tarefa)</label>
            </div>
            <TagPicker options={tagOptions} selected={tags} onChange={setTags} name="tags" disabled={busy !== null} />
          </div>
        )}
        <TipoContatoFields
          initialTipo={task.tipo}
          contactId={task.contactId}
          contacts={contacts}
          companyId={companyId}
        />
        <label>
          Prazo
          <input
            name="dueAt"
            type="date"
            defaultValue={task.dueAt ? task.dueAt.slice(0, 10) : ""}
            required
          />
        </label>
        <label>
          Responsável
          <select name="assigneeUserId" defaultValue={task.assigneeUserId} required>
            {memberships.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberDisplayName(m.userId, memberships)}
              </option>
            ))}
          </select>
        </label>
      </form>

      <AttachmentsSection
        attachments={attachments}
        busy={busy}
        meUserId={me.user.id}
        canRemove={canDeleteOwn}
        onUpload={handleUpload}
        onRemove={(id) =>
          void run(
            `attach:${id}`,
            () => removeTaskAttachmentAction(task.id, id),
            (list) => setAttachments(list),
            "Anexo removido",
          )
        }
        getUrl={urlDoAnexo}
      />

      <div className="task-detail-section">
        <div className="drawer-section-title">Comentários{task.comments.length > 0 ? ` · ${task.comments.length}` : ""}</div>
        <div className="chat-thread">
          {task.comments.length > 0 ? (
            task.comments.map((c) => {
              const authorName = memberDisplayName(c.authorUserId, memberships);
              return (
                <div key={c.id} className="chat-msg">
                  <div className="chat-avatar">{initialsOf(authorName)}</div>
                  <div className="chat-bubble">
                    <div className="chat-msg-head">
                      <span className="chat-author">{authorName}</span>
                      <span className="chat-time">{formatDateTimeBR(c.createdAt)}</span>
                    </div>
                    <div className="chat-text">{c.body}</div>
                    {c.authorUserId === me.user.id && canDeleteOwn && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: 0, marginTop: 4 }}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            `comment:${c.id}`,
                            () => removeTaskCommentAction(task.id, c.id),
                            () => setTask((prev) => ({ ...prev, comments: prev.comments.filter((x) => x.id !== c.id) })),
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
            <div className="chat-empty">Nenhum comentário ainda. Registre o andamento da tarefa.</div>
          )}
        </div>
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
    </>
  );
}

// Rodapé (protótipo: botões de renderTaskDetailModal).
export function DetailFooter() {
  const { data, task, busy, isModal, setStatus, remove, close } = useTaskDetail();
  const done = task.status === "done";
  // Representante não exclui nenhum tipo de registro (pedido do usuário,
  // 2026-08-06, ver PolicyService#can) — botão escondido pra não oferecer
  // uma ação que o backend vai rejeitar de qualquer forma.
  const canDelete = data.me.membership.role !== "sales_rep";
  const disabled = busy !== null;

  return (
    <>
      {/* Concluir/Reabrir sozinho no canto esquerdo, verde (2026-09-04):
          era o botão azul colado no "Salvar" e o usuário concluiu uma
          tarefa quando só queria trocar o prazo. */}
      <button
        type="button"
        className={done ? "btn" : "btn btn-success"}
        style={{ marginRight: "auto" }}
        disabled={disabled}
        onClick={() => void setStatus(done ? "pending" : "done", done ? "Tarefa reaberta" : "Tarefa concluída ✓")}
      >
        {busy === "status" ? (done ? "Reabrindo…" : "Concluindo…") : done ? "Reabrir" : "Concluir"}
      </button>
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
        <Link href="/dashboard/tarefas" className="btn btn-ghost">
          Fechar
        </Link>
      )}
      <button type="submit" form={EDIT_FORM_ID} className="btn btn-primary" disabled={disabled}>
        {busy === "save" ? "Salvando…" : "Salvar"}
      </button>
    </>
  );
}
