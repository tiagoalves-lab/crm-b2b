"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Modal centralizado reaproveitado por todo CRUD/detalhe (protótipo:
// #overlay/#modal em gama-crm-mvp.html, funções openModal/closeModal).
// Renderizado dentro do slot paralelo @modal (rota interceptada) — fechar
// = router.back() volta pra rota de fundo sem perder o estado da lista.
export default function OverlayModal({
  title,
  children,
  footer,
  wide,
  xl,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  // Mais largo ainda (card de Oportunidade, 2026-09-04): o card tem duas
  // colunas — conteúdo + lista lateral de itens — e não cabe em 720px.
  xl?: boolean;
}) {
  const router = useRouter();
  const close = () => router.back();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overlay open" onClick={close}>
      <div
        className={xl ? "modal wide xl" : wide ? "modal wide" : "modal"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={close} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
