"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportResult } from "@/lib/api/raw-leads";
import { importLeadsSpreadsheetAction } from "./actions";

// Importação em massa (crawler CNPJ, Econodata etc.) — aceita .csv/.xlsx.
// O arquivo nunca passa por leitura no navegador além do <input>: o
// Server Action reenvia o File pro backend, que parseia e cria os leads
// (mesma regra do form manual acima: company nasce junto, tag lead-triagem).
export default function ImportSpreadsheetForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const res = await importLeadsSpreadsheetAction(file);
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
      <label>
        Arquivo (.csv ou .xlsx)
        <input ref={inputRef} type="file" name="file" accept=".csv,.xlsx,.xls" required />
      </label>
      <div className="t-sub" style={{ alignSelf: "end", marginBottom: 8 }}>
        Colunas aceitas: CNPJ, Empresa, Fantasia, Cidade, UF, Telefone, Telefone 2, Email
        (Receita), Porte, Socios (QSA), CNAE, Abertura.
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Importando…" : "Importar planilha"}
      </button>

      {error && <div className="error-banner">{error}</div>}

      {result && (
        <div className="panel" style={{ marginTop: 4 }}>
          <div className="panel-body" style={{ padding: 12, fontSize: 13 }}>
            <b>{result.imported}</b> de <b>{result.total}</b> linha(s) importada(s) com sucesso.
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
