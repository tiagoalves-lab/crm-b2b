"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CONTACTS_TEMPLATE_HEADERS, type ImportResult } from "@/lib/api/raw-leads";
import { importLeadsContactsSpreadsheetAction } from "./actions";
import SubmitButton from "@/app/_components/submit-button";

// Modelo padrão FIXO com múltiplos contatos por empresa: a empresa se repete
// pelo mesmo CNPJ em várias linhas, uma linha = um contato. O backend
// (src/raw-leads/contacts-spreadsheet-import.util.ts) rejeita (400) qualquer
// cabeçalho fora deste template — "Copiar modelo" copia a linha de
// cabeçalho separada por TAB, que o Excel/Google Sheets já cola em colunas
// separadas ao colar na célula A1.
export default function ImportContactsSpreadsheetForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopyTemplate() {
    await navigator.clipboard.writeText(CONTACTS_TEMPLATE_HEADERS.join("\t"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Selecione um arquivo .csv ou .xlsx primeiro.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    const res = await importLeadsContactsSpreadsheetAction(file);
    setBusy(false);

    if (!res.ok) {
      setError(res.message);
      return;
    }
    setResult(res.data);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="form-grid">
      <div className="t-sub" style={{ marginBottom: 4 }}>
        Cabeçalho fixo — cada linha é <b>um contato</b>; repita o CNPJ da
        empresa em quantas linhas ela tiver contatos. Colunas fora deste
        modelo travam a importação com erro.
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ alignSelf: "start" }}
        onClick={() => void handleCopyTemplate()}
      >
        {copied ? "✓ Copiado! Cole na célula A1 do Excel/Sheets" : "Copiar modelo de cabeçalho"}
      </button>
      <div className="t-sub" style={{ fontFamily: "monospace", fontSize: 11 }}>
        {CONTACTS_TEMPLATE_HEADERS.join(" | ")}
      </div>

      <label>
        Arquivo (.csv ou .xlsx) no modelo acima
        <input ref={inputRef} type="file" name="file" accept=".csv,.xlsx,.xls" required />
      </label>
      <SubmitButton className="btn btn-primary" disabled={busy}>
        {busy ? "Importando…" : "Importar planilha com contatos"}
      </SubmitButton>

      {error && <div className="error-banner">{error}</div>}

      {result && (
        <div className="panel" style={{ marginTop: 4 }}>
          <div className="panel-body" style={{ padding: 12, fontSize: 13 }}>
            <b>{result.imported}</b> de <b>{result.total}</b> contato(s) importado(s) com sucesso.
            {result.errors.length > 0 && (
              <>
                <div style={{ marginTop: 8, color: "var(--danger)" }}>
                  {result.errors.length} linha(s) com erro:
                </div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {result.errors.slice(0, 20).map((e) => (
                    <li key={e.row}>
                      Linha {e.row}: {e.reason}
                    </li>
                  ))}
                </ul>
                {result.errors.length > 20 && (
                  <div className="t-sub">+ {result.errors.length - 20} outra(s)…</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
