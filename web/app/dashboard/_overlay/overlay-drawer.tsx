"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Drawer lateral reaproveitado pela ficha de empresa/lead (protótipo:
// #drawerOverlay/#drawer em gama-crm-mvp.html, funções openFicha/
// openLeadFicha/closeFicha). Renderizado dentro do slot paralelo @drawer
// (rota interceptada) — fechar = router.back().
export default function OverlayDrawer({
  head,
  tabs,
  children,
}: {
  head: React.ReactNode;
  tabs?: React.ReactNode;
  children: React.ReactNode;
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
    <>
      <div className="drawer-overlay open" onClick={close} />
      <div className="drawer open">
        <div className="drawer-head">
          <div className="drawer-head-top">
            {head}
            <button type="button" className="btn btn-ghost btn-sm" onClick={close} aria-label="Fechar">
              ✕
            </button>
          </div>
        </div>
        {tabs && <div className="drawer-tabs">{tabs}</div>}
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}
