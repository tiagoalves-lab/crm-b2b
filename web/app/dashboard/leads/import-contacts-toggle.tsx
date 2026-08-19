"use client";

import { useEffect, useRef, useState } from "react";
import ImportContactsSpreadsheetForm from "./import-contacts-spreadsheet-form";

// Ajuste de layout pedido pelo usuário (2026-08-05): "Importar planilha com
// múltiplos contatos por empresa" saiu de um <details> solto no meio do
// conteúdo (antes das estatísticas/tabela) e virou uma ação do cabeçalho,
// ao lado de "Recalcular scores"/"Nova empresa" — mesmo lugar de qualquer
// outra ação de topo da tela. Vira um dropdown ancorado no próprio botão
// (position: relative no wrapper, absolute no painel) em vez de navegar
// pra um modal/rota — o form já existia pronto (ImportContactsSpreadsheetForm),
// só mudou onde ele aparece.
export default function ImportContactsToggle() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="import-contacts-toggle" ref={wrapperRef}>
      <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <path d="M7 10l5 5 5-5M12 15V3" />
        </svg>
        Importar planilha
      </button>
      {open && (
        <div className="import-contacts-dropdown">
          <div className="t-sub" style={{ marginBottom: 8, fontWeight: 600 }}>
            Importar planilha com múltiplos contatos por empresa
          </div>
          <ImportContactsSpreadsheetForm />
        </div>
      )}
    </div>
  );
}
