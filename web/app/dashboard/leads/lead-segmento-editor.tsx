"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { setLeadSegmentoAction } from "./actions";

// Editor de segmento de negócio — mesmo lugar/mesmo padrão de
// LeadTagsEditor (linha da tabela + aba "Dados" da ficha), pedido direto
// do usuário (2026-08-05, mesma sessão da tag). Diferença: valor único
// (não array) — confirmado via pergunta direta ("um segmento por vez") —
// então é um input de texto simples que salva ao sair do campo/Enter, em
// vez da lista de chips das tags.
export default function LeadSegmentoEditor({
  leadId,
  segmento,
  readOnly = false,
}: {
  leadId: string;
  segmento: string | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(segmento ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mesmo bug/mesmo motivo do useEffect em LeadTagsEditor: quando a
  // mudança vem de fora (BulkEditModal), o `<tr key={lead.id}>` preserva a
  // instância deste componente entre renders, então o `useState(segmento)`
  // inicial não reroda sozinho — sincroniza sempre que a prop mudar.
  useEffect(() => {
    setValue(segmento ?? "");
  }, [segmento]);

  async function persist() {
    const next = value.trim();
    if (next === (segmento ?? "").trim()) return; // nada mudou, não bate a API à toa
    setBusy(true);
    setError(null);
    const res = await setLeadSegmentoAction(leadId, next || null);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      setValue(segmento ?? ""); // desfaz o que o usuário digitou
      return;
    }
    setValue(res.data.segmento ?? "");
    router.refresh();
  }

  if (readOnly) {
    return <span className="t-sub">{segmento ?? "—"}</span>;
  }

  return (
    <div>
      <input
        className="segmento-input"
        value={value}
        placeholder="—"
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {error && (
        <div className="t-sub" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
