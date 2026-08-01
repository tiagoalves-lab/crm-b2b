"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { rescoreLeadsAction } from "./actions";

// Ação do topbar (protótipo: renderTopActions → "Recalcular scores" na
// view triagem). Isolado num componente próprio pra não misturar com o
// estado de seleção em lote de LeadsTable.
export default function RescoreButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    await rescoreLeadsAction();
    setBusy(false);
    router.refresh();
  }

  return (
    <button type="button" className="btn" onClick={() => void handleClick()} disabled={busy}>
      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
      </svg>
      {busy ? "Recalculando…" : "Recalcular scores"}
    </button>
  );
}
