"use client";

import { useState } from "react";
import type { BuscaEmpresaLeadResult } from "@/lib/api/search";
import {
  approveLeadAction,
  createCompanyFromCnpjAction,
  searchEmpresaLeadAction,
} from "./actions";

interface Picked {
  id: string;
  name: string;
}

// Seletor de empresa obrigatório do "Nova oportunidade" (SPEC-CRM-GAMA.md
// §4.2.1) — três caminhos: casar com empresa já cadastrada, casar com lead
// em triagem (aprova na hora, sem confirmação) ou cadastrar nova pelo
// CNPJ. Renderiza um <input type="hidden" name="companyId"> dentro do
// <form> pai (não tem form próprio) pra o valor viajar junto no submit de
// createOpportunityAction.
export default function CompanyPicker() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuscaEmpresaLeadResult[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(value: string) {
    setQuery(value);
    setError(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    const items = await searchEmpresaLeadAction(value);
    setResults(items);
  }

  async function handlePickResult(item: BuscaEmpresaLeadResult) {
    if (item.origem === "empresa") {
      setPicked({ id: item.id, name: item.nome });
      setResults([]);
      setQuery("");
      return;
    }

    setLoading(true);
    setError(null);
    const res = await approveLeadAction(item.id);
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPicked(res.data);
    setResults([]);
    setQuery("");
  }

  async function handleCreateByCnpj() {
    const digits = query.replace(/\D/g, "");
    if (digits.length !== 14) {
      setError("Digite um CNPJ válido (14 dígitos) pra cadastrar uma empresa nova.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await createCompanyFromCnpjAction(digits);
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPicked(res.data);
    setResults([]);
    setQuery("");
  }

  if (picked) {
    return (
      <div className="row-form">
        <input type="hidden" name="companyId" value={picked.id} />
        <span className="badge badge-accent">{picked.name}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setPicked(null)}
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        placeholder="Buscar empresa ou lead por nome/CNPJ..."
        value={query}
        onChange={(e) => void handleSearch(e.target.value)}
      />
      {loading && <p className="sub" style={{ marginTop: 6 }}>Processando…</p>}
      {error && <div className="error-banner" style={{ marginTop: 6 }}>{error}</div>}

      {results.length > 0 && (
        <div className="picker-results">
          {results.map((r) => (
            <div
              key={`${r.origem}-${r.id}`}
              className="picker-result"
              onClick={() => void handlePickResult(r)}
            >
              <span className={r.origem === "lead" ? "badge" : "badge badge-accent"}>
                {r.origem}
              </span>
              <span className="picker-result-nome">{r.nome}</span>
              <span className="sub">{r.cnpj ?? "sem CNPJ"}</span>
              {r.origem === "lead" && (
                <span className="sub" style={{ color: "var(--accent)" }}>
                  aprovar e vincular →
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => void handleCreateByCnpj()}
        >
          Nenhum resultado — cadastrar empresa pelo CNPJ &quot;{query}&quot;
        </button>
      )}
    </div>
  );
}
