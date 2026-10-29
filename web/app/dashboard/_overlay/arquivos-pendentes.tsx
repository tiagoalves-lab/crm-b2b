"use client";

import { useRef } from "react";

import { attachKind, formatBytes } from "./attachments";
import { useColarArquivos } from "./colar-arquivos";

// Arquivos escolhidos num CADASTRO (Nova tarefa, Nova oportunidade), que
// ainda não têm onde subir: ficam em memória e o formulário envia depois
// que o registro nasce. Escolher no botão ou colar com Ctrl+V soma à
// lista; o ✕ tira da lista antes de enviar.
export function ArquivosPendentes({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function adicionar(novos: File[]) {
    if (novos.length > 0) onChange([...files, ...novos]);
  }

  useColarArquivos(adicionar);

  return (
    <>
      <div className="attach-pick">
        <input
          type="file"
          ref={fileRef}
          hidden
          multiple
          onChange={(event) => {
            const novos = Array.from(event.target.files ?? []);
            event.target.value = "";
            adicionar(novos);
          }}
        />
        <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          + Anexar arquivo
        </button>
        <span className="field-hint" style={{ marginTop: 0 }}>
          ou cole com Ctrl+V (print, PDF, qualquer arquivo)
        </span>
      </div>
      {files.map((file, i) => {
        const kind = attachKind(file.type || null);
        return (
          <div key={`${file.name}-${i}`} className="attach-item">
            <div className={`attach-icon ${kind}`}>
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="attach-name">{file.name}</div>
              <div className="attach-meta">
                {kind.toUpperCase()} · {formatBytes(file.size)}
              </div>
            </div>
            <button
              type="button"
              className="icon-btn danger"
              title="Tirar da lista"
              onClick={() => onChange(files.filter((_, j) => j !== i))}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </>
  );
}
