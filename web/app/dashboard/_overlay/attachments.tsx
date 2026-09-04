"use client";

import { useEffect, useRef, useState } from "react";

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
}

type Kind = "pdf" | "imagem" | "planilha" | "outro";

function attachKind(mimeType: string | null): Kind {
  if (!mimeType) return "outro";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "imagem";
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType === "text/csv") return "planilha";
  return "outro";
}

function formatBytes(bytes: number | null): string {
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
  onUpload,
  onRemove,
  getUrl,
}: {
  attachments: AttachmentRow[];
  // Chave de ocupado da ficha: "upload" enquanto envia, `attach:<id>` ao
  // remover, `download:<id>` ao pegar a URL assinada.
  busy: string | null;
  meUserId: string;
  canRemove: boolean;
  onUpload: (file: File) => void;
  onRemove: (id: string) => void;
  getUrl: (id: string) => Promise<string | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ attachment: AttachmentRow; url: string } | null>(null);
  const ocupado = busy !== null;

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
          disabled={ocupado}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // O envio começa na hora de escolher — o valor é limpo já,
            // pra dar pra reenviar o mesmo arquivo depois se precisar.
            event.target.value = "";
            if (file) onUpload(file);
          }}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={ocupado}
          aria-busy={busy === "upload" || undefined}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "upload" ? "Enviando…" : "+ Anexar arquivo"}
        </button>
      </div>

      {attachments.length === 0 ? (
        <div className="attach-empty">Nenhum arquivo. Anexe foto, PDF ou planilha.</div>
      ) : (
        attachments.map((att) => {
          const kind = attachKind(att.mimeType);
          return (
            <div key={att.id} className="attach-item">
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
                <div className="attach-name">{att.fileName}</div>
                <div className="attach-meta">
                  {kind.toUpperCase()}
                  {att.sizeBytes !== null ? ` · ${formatBytes(att.sizeBytes)}` : ""}
                </div>
              </button>
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
