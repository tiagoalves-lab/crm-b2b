"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

// Itens da oportunidade e as tags que nascem deles (2026-09-04).
//
// Três peças reusadas pelo card de Oportunidade (cadastro e detalhe) e
// pela tarefa gerada a partir dele:
// - ItemsPanel: a lista lateral onde o usuário digita os itens;
// - TagPicker: chips clicáveis pra escolher quais itens carimbar num
//   comentário ou numa tarefa;
// - TagChips: o carimbo já gravado, só leitura.
//
// Quem chama decide o que acontece ao adicionar/remover: no cadastro é
// estado local (a lista viaja no submit), no card já salvo é uma Server
// Action por item.

export function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <div className={className ?? "tag-stamp-row"}>
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
        </span>
      ))}
    </div>
  );
}

// Controlado. Com `name`, cada chip marcado vira <input type="hidden">
// pra viajar no submit do <form> pai (sem form próprio).
export function TagPicker({
  options,
  selected,
  onChange,
  name,
  disabled,
  hint,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  name?: string;
  disabled?: boolean;
  hint?: string;
}) {
  if (options.length === 0) return null;
  const on = new Set(selected);

  function toggle(tag: string) {
    onChange(on.has(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  }

  return (
    <div className="tag-pick-block">
      {hint && <div className="tag-pick-hint">{hint}</div>}
      <div className="tag-pick-row">
        {options.map((tag) => (
          <button
            key={tag}
            type="button"
            className={on.has(tag) ? "tag-pick on" : "tag-pick"}
            aria-pressed={on.has(tag)}
            disabled={disabled}
            onClick={() => toggle(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      {name && selected.map((tag) => <input key={tag} type="hidden" name={name} value={tag} />)}
    </div>
  );
}

export interface ItemsPanelItem {
  key: string;
  name: string;
  // Valor do item (2026-09-04). null/ausente = ainda sem preço.
  amount?: number | null;
}

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Campo de valor de um item. Guarda o que está sendo digitado e só
// avisa quem chamou ao sair do campo (ou no Enter) — uma ida ao
// servidor por item editado, não por tecla.
function ItemAmount({
  item,
  onChange,
  disabled,
}: {
  item: ItemsPanelItem;
  onChange: (item: ItemsPanelItem, amount: number | null) => void;
  disabled?: boolean;
}) {
  const saved = item.amount === null || item.amount === undefined ? "" : String(item.amount);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);

  function commit() {
    const texto = draft.replace(",", ".").trim();
    if (texto === saved) return;
    if (texto === "") {
      if (saved !== "") onChange(item, null);
      return;
    }
    const valor = Number(texto);
    if (!Number.isFinite(valor) || valor < 0) {
      setDraft(saved);
      return;
    }
    onChange(item, valor);
  }

  return (
    <input
      className="opp-item-amount"
      inputMode="decimal"
      placeholder="R$ —"
      value={draft}
      disabled={disabled}
      aria-label={"Valor de " + item.name}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function ItemsPanel({
  items,
  onAdd,
  onRemove,
  onChangeAmount,
  busyKey,
  disabled,
  canEdit = true,
}: {
  items: ItemsPanelItem[];
  // Devolve false pra manter o texto digitado (ex.: item repetido).
  onAdd: (name: string) => boolean | void | Promise<boolean | void>;
  onRemove: (item: ItemsPanelItem) => void;
  // Valor por item (2026-09-04). Sem esta prop a coluna não mostra
  // campo de valor — é o caso do cadastro, onde o item ainda não
  // existe no banco pra receber preço.
  onChangeAmount?: (item: ItemsPanelItem, amount: number | null) => void;
  // "add" enquanto adiciona; a key do item enquanto remove.
  busyKey?: string | null;
  disabled?: boolean;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const comValor = items.filter((item) => item.amount !== null && item.amount !== undefined);
  const total =
    comValor.length > 0 ? comValor.reduce((soma, item) => soma + (item.amount ?? 0), 0) : null;

  async function submit() {
    const name = draft.replace(/\s+/g, " ").trim();
    if (!name) return;
    const kept = await onAdd(name);
    if (kept !== false) setDraft("");
  }

  // Enter adiciona o item — e NÃO envia o <form> de cadastro que envolve
  // a lista (o submit é o botão do rodapé).
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="opp-side-panel">
      <div className="drawer-section-title" style={{ marginTop: 0 }}>
        Itens{items.length > 0 ? ` · ${items.length}` : ""}
      </div>
      {items.length === 0 ? (
        <div className="opp-item-empty">
          O que está sendo negociado. Cada item vira uma tag pra carimbar comentários e tarefas desta
          oportunidade.
        </div>
      ) : (
        <ul className="opp-items">
          {items.map((item) => (
            <li key={item.key} className="opp-item">
              <div className="opp-item-head">
                <span className="opp-item-name">{item.name}</span>
                {canEdit && (
                  <button
                    type="button"
                    className="tag-chip-remove"
                    title="Remover item"
                    aria-label={`Remover ${item.name}`}
                    disabled={disabled}
                    aria-busy={busyKey === item.key || undefined}
                    onClick={() => onRemove(item)}
                  >
                    ×
                  </button>
                )}
              </div>
              {onChangeAmount &&
                (canEdit ? (
                  <ItemAmount item={item} onChange={onChangeAmount} disabled={disabled} />
                ) : (
                  item.amount !== null &&
                  item.amount !== undefined && (
                    <div className="opp-item-amount-read">{brl(item.amount)}</div>
                  )
                ))}
            </li>
          ))}
        </ul>
      )}
      {/* Total dos itens (2026-09-04): é ele que vira o valor da
          oportunidade — quem soma de verdade é o backend, a cada item
          gravado. */}
      {total !== null && (
        <div className="opp-item-total">
          <span>Total</span>
          <strong>{brl(total)}</strong>
        </div>
      )}
      {canEdit && (
        <div className="opp-item-add">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Novo item + Enter"
            maxLength={120}
            disabled={disabled}
            aria-label="Novo item"
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={disabled || draft.trim() === ""}
            aria-busy={busyKey === "add" || undefined}
            onClick={() => void submit()}
          >
            {busyKey === "add" ? "…" : "+"}
          </button>
        </div>
      )}
    </div>
  );
}
