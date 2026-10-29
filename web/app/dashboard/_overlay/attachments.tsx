"use client";

import { useEffect, useRef, useState } from "react";

import { formatDateTimeBR } from "@/lib/format-date";
import { useColarArquivos } from "./colar-arquivos";

// Bloco de anexos das fichas ricas (card de Oportunidade e ficha de
// Tarefa), 2026-09-04. Nasceu de dois pedidos do usuário no mesmo dia:
//
// 1. "Deixe mais discreto aquele bloco de anexo. Está muito grande para
//    inserir um arquivo." — a caixa tracejada de 140px virou um botão
//    pequeno; escolher o arquivo já dispara o envio (sem passo "Enviar").
// 2. "É possível criar um visualizador do anexo na web igual no Trello?"
//    — clicar no anexo abre a prévia por cima da ficha: imagem no <img>,
//    PDF no <iframe> (o navegador tem leitor próprio), o resto oferece
//    baixar. A URL é a mesma assinada e temporária do download; o arquivo
//    continua saindo direto do Storage, sem passar pelo NestJS.
//
// Sem <form> de propósito: com um, qualquer submit que escape do React
// vira navegação de verdade pra própria URL e, fora da interceptação, o
// modal "vira tela cheia" (ver task-detail.tsx/opportunity-detail.tsx).

export interface AttachmentRow {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string;
  createdAt: string;
  // Só o card de Oportunidade usa publicação (2026-09-15); a ficha de
  // Tarefa não passa o campo, e aí nenhum selo aparece.
  publishedAt?: string | null;
}

type Kind = "pdf" | "imagem" | "planilha" | "outro";

export function attachKind(mimeType: string | null): Kind {
  if (!mimeType) return "outro";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "imagem";
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType === "text/csv") return "planilha";
  return "outro";
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Prévia por cima da ficha. Fecha no Esc, no ✕ e no clique fora — mesma
// mecânica do OverlayModal, mas sem rota: é estado local, então fechar a
// prévia nunca mexe no histórico do navegador (e nunca fecha a ficha).
function AttachmentViewer({
  attachment,
  url,
  onClose,
}: {
  attachment: AttachmentRow;
  url: string;
  onClose: () => void;
}) {
  const kind = attachKind(attachment.mimeType);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="attach-viewer" onClick={onClose}>
      <div className="attach-viewer-box" onClick={(event) => event.stopPropagation()}>
        <div className="attach-viewer-head">
          <div className="attach-viewer-name" title={attachment.fileName}>
            {attachment.fileName}
          </div>
          <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm">
            Abrir em nova aba
          </a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar prévia">
            ✕
          </button>
        </div>
        <div className="attach-viewer-body">
          {kind === "imagem" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={attachment.fileName} />
          ) : kind === "pdf" ? (
            <iframe src={url} title={attachment.fileName} />
          ) : (
            <div className="attach-viewer-empty">
              <p>Este tipo de arquivo não abre aqui dentro.</p>
              <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm">
                Baixar arquivo
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AttachmentsSection({
  attachments,
  busy,
  meUserId,
  canRemove,
  canPublish = false,
  multiple = false,
  nomeDoAutor,
  onUpload,
  onRemove,
  onPublish,
  getUrl,
}: {
  attachments: AttachmentRow[];
  // Chave de ocupado da ficha: "upload" enquanto envia, `attach:<id>` ao
  // remover, `download:<id>` ao pegar a URL assinada.
  busy: string | null;
  meUserId: string;
  canRemove: boolean;
  // Publicação do anexo (card de Oportunidade): anexo novo já entra
  // publicado (reserva desativada em 2026-10-16); o selo e o botão só
  // aparecem nos reservados que ficaram de antes. Quem não pode
  // publicar nem recebe esses anexos do backend — a tela só mostra o
  // selo e o botão pra quem pode.
  canPublish?: boolean;
  // Quem enviou o anexo aparece com nome de gente, não com id: a ficha
  // já carrega a lista de membros e resolve o nome (pedido do usuário,
  // 2026-09-14 — mostrar data/hora e quem inseriu cada arquivo).
  nomeDoAutor: (userId: string) => string;
  // Vários arquivos numa escolha só (card de Oportunidade, 2026-09-17);
  // a ficha de Tarefa segue com um por vez e recebe sempre 1 item.
  multiple?: boolean;
  onUpload: (files: File[]) => void;
  onRemove: (id: string) => void;
  onPublish?: (id: string) => void;
  getUrl: (id: string) => Promise<string | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ attachment: AttachmentRow; url: string } | null>(null);
  const ocupado = busy !== null;

  // Ctrl+V com a ficha aberta anexa na hora, igual escolher no botão.
  useColarArquivos((files) => {
    if (ocupado) return;
    onUpload(multiple ? files : files.slice(0, 1));
  });

  async function abrir(attachment: AttachmentRow) {
    const url = await getUrl(attachment.id);
    if (url) setPreview({ attachment, url });
  }

  return (
    <div className="task-detail-section">
      <div className="attach-head">
        <div className="drawer-section-title" style={{ marginTop: 0, marginBottom: 0 }}>
          Anexos{attachments.length > 0 ? ` · ${attachments.length}` : ""}
        </div>
        <input
          type="file"
          ref={fileRef}
          hidden
          multiple={multiple}
          disabled={ocupado}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // O envio começa na hora de escolher — o valor é limpo já,
            // pra dar pra reenviar o mesmo arquivo depois se precisar.
            event.target.value = "";
            if (files.length > 0) onUpload(files);
          }}
        />
        <button
          type="button"
          className="btn btn-sm"
          title="Ou cole com Ctrl+V"
          disabled={ocupado}
          aria-busy={busy === "upload" || undefined}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "upload" ? "Enviando…" : "+ Anexar arquivo"}
        </button>
      </div>

      {attachments.length === 0 ? (
        <div className="attach-empty">Nenhum arquivo. Anexe foto, PDF ou planilha — ou cole com Ctrl+V.</div>
      ) : (
        attachments.map((att) => {
          const kind = attachKind(att.mimeType);
          // null = reservado; undefined = ficha que não usa publicação.
          const reservado = att.publishedAt === null;
          return (
            <div key={att.id} className={`attach-item${reservado ? " reservado" : ""}`}>
              <div className={`attach-icon ${kind}`}>
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              </div>
              <button
                type="button"
                className="attach-info"
                title="Ver o arquivo"
                disabled={ocupado}
                aria-busy={busy === `download:${att.id}` || undefined}
                onClick={() => void abrir(att)}
              >
                <div className="attach-name-row">
                  <div className="attach-name">{att.fileName}</div>
                  {reservado && <span className="attach-flag">Não publicado</span>}
                </div>
                <div className="attach-meta">
                  {kind.toUpperCase()}
                  {att.sizeBytes !== null ? ` · ${formatBytes(att.sizeBytes)}` : ""}
                </div>
                <div className="attach-meta">
                  {`Enviado por ${nomeDoAutor(att.uploadedBy)} · ${formatDateTimeBR(att.createdAt)}`}
                </div>
              </button>
              {reservado && canPublish && onPublish && (
                <button
                  type="button"
                  className="icon-btn publicar"
                  title="Publicar para gerente e representante"
                  disabled={ocupado}
                  aria-busy={busy === `publish:${att.id}` || undefined}
                  onClick={() => {
                    // Não tem desfazer: confirma antes de liberar.
                    if (
                      window.confirm(
                        `Publicar "${att.fileName}"? Gerente e representante passam a ver o arquivo, e isso não tem volta — só excluindo o anexo.`,
                      )
                    ) {
                      onPublish(att.id);
                    }
                  }}
                >
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              )}
              {att.uploadedBy === meUserId && canRemove && (
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Remover"
                  disabled={ocupado}
                  aria-busy={busy === `attach:${att.id}` || undefined}
                  onClick={() => onRemove(att.id)}
                >
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          );
        })
      )}

      {preview && (
        <AttachmentViewer
          attachment={preview.attachment}
          url={preview.url}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
