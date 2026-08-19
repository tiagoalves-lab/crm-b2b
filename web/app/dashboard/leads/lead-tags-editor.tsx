"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { setLeadTagsAction } from "./actions";

// Editor de tags livres do lead — usado na linha da tabela (leads-table.tsx)
// e na aba "Dados" da ficha (_ficha/ficha-body.tsx), pedido direto do
// usuário (2026-08-05), fora do SPEC-CRM-GAMA.md original. Texto livre
// (sem lista pré-definida — decisão do usuário): qualquer palavra digitada
// vira uma tag nova na hora, sem precisar cadastrar antes em outro lugar.
// Mantém cópia local do array (em vez de só refletir a prop) pra atualizar
// os chips na hora, sem esperar o `router.refresh()` recarregar a página
// inteira — mesmo motivo de TipoContatoFields#localContacts (tarefas).
export default function LeadTagsEditor({
  leadId,
  tags,
  readOnly = false,
}: {
  leadId: string;
  tags: string[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [localTags, setLocalTags] = useState(tags);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bug real achado pelo usuário (2026-08-05, testando "Editar em lote"):
  // quando a mudança vem de FORA deste componente (BulkEditModal chama
  // setLeadTagsAction direto, não passa por este editor), `router.refresh()`
  // busca `tags` novo no servidor, mas como o `<tr key={lead.id}>` mantém a
  // mesma instância de LeadTagsEditor entre renders, o `useState(tags)`
  // inicial não roda de novo — a linha ficava mostrando "Sem tags" mesmo
  // com o valor já salvo no banco. Sincroniza sempre que a prop mudar
  // (mesmo padrão de TipoContatoFields#localContacts, tarefas).
  useEffect(() => {
    setLocalTags(tags);
  }, [tags]);

  async function persist(next: string[]) {
    setBusy(true);
    setError(null);
    const res = await setLeadTagsAction(leadId, next);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setLocalTags(res.data.tags);
    router.refresh();
  }

  function handleAdd() {
    const value = draft.trim();
    if (!value) return;
    if (localTags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    setDraft("");
    void persist([...localTags, value]);
  }

  function handleRemove(tag: string) {
    void persist(localTags.filter((t) => t !== tag));
  }

  return (
    <div className="tag-editor">
      <div className="tag-chip-list">
        {localTags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            {!readOnly && (
              <button
                type="button"
                className="tag-chip-remove"
                onClick={() => handleRemove(tag)}
                disabled={busy}
                title={`Remover tag "${tag}"`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {localTags.length === 0 && <span className="t-sub">Sem tags</span>}
      </div>
      {!readOnly && (
        <input
          className="tag-add-input"
          placeholder="+ tag"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          onBlur={() => draft.trim() && handleAdd()}
        />
      )}
      {error && (
        <div className="t-sub" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
