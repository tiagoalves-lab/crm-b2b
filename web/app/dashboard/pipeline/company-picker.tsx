"use client";

import { useState } from "react";
import NovaEmpresaFicha from "@/app/dashboard/empresas/_ficha/nova-ficha";
import type { BuscaEmpresaLeadResult } from "@/lib/api/search";
import { approveLeadAction, searchEmpresaLeadAction } from "./actions";

interface Picked {
  id: string;
  name: string;
}

// Seletor de empresa obrigatório do "Nova oportunidade" (SPEC-CRM-GAMA.md
// §4.2.1) — três caminhos: casar com empresa já cadastrada, casar com lead
// em triagem (aprova na hora, sem confirmação) ou cadastrar uma empresa
// nova sem sair daqui. Renderiza um <input type="hidden" name="companyId">
// dentro do <form> pai (não tem form próprio) pra o valor viajar junto no
// submit de createOpportunityAction. Reusado também em
// tarefas/nova/nova-form.tsx (pedido do usuário, 2026-08-04: trocar o
// <select> de Empresa por busca com autocomplete + cadastro inline) —
// onPick é opcional, só quem precisa reagir à escolha (ex.: recarregar a
// lista de Contatos) passa.
//
// Cadastro de empresa nova (2026-09-15, pedido do usuário): antes o botão
// só aceitava CNPJ digitado e criava a empresa em silêncio, com o que a
// Receita devolvesse. Agora abre a MESMA ficha de cadastro de Empresas
// (empresas/_ficha/nova-ficha.tsx, variante "modal"): consulta a Receita,
// deixa conferir/completar os campos e, depois de salvar, cadastrar os
// contatos. A empresa entra no seletor no momento em que é salva, então
// fechar o modal devolve a oportunidade com ela já escolhida.
export default function CompanyPicker({ onPick }: { onPick?: (companyId: string) => void } = {}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuscaEmpresaLeadResult[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cadastrando, setCadastrando] = useState(false);
  const [criadaAgora, setCriadaAgora] = useState<string | null>(null);

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

  function pick(next: Picked) {
    setPicked(next);
    setResults([]);
    setQuery("");
    onPick?.(next.id);
  }

  function clear() {
    setPicked(null);
    onPick?.("");
  }

  async function handlePickResult(item: BuscaEmpresaLeadResult) {
    if (item.origem === "empresa") {
      pick({ id: item.id, name: item.nome });
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
    pick(res.data);
  }

  function fecharCadastro() {
    setCadastrando(false);
    // Contatos podem ter sido cadastrados no modal — recarrega a lista de
    // contatos do formulário de origem (é o que onPick faz).
    if (criadaAgora) onPick?.(criadaAgora);
    setCriadaAgora(null);
  }

  // Salvar a empresa já a seleciona (troca o corpo do seletor pelo estado
  // "selecionada"), e o modal precisa continuar aberto pra dar tempo de
  // cadastrar os contatos — por isso ele fica fora dos dois ramos do return.
  const modalCadastro = cadastrando && (
    <NovaEmpresaFicha
      variant="modal"
      termoInicial={query}
      onCadastrada={(empresa) => {
        setCriadaAgora(empresa.id);
        pick({ id: empresa.id, name: empresa.nome });
      }}
      onFechar={fecharCadastro}
    />
  );

  // Um return só, com o modal SEMPRE no mesmo lugar da árvore
  // (2026-09-15): salvar a empresa troca o seletor pelo estado
  // "selecionada", e com dois returns o modal mudava de posição — o React
  // desmontava e montava de novo o cadastro, que voltava vazio e "não
  // salvo" em vez de seguir pro painel de contatos.
  return (
    <div className="co-picker">
      {picked ? (
        <>
          <input type="hidden" name="companyId" value={picked.id} />
          <div className="co-picker-selected">
            <span className="co-tag empresa">selecionada</span>
            <span className="co-nome">{picked.name}</span>
            <button type="button" className="co-picker-clear" title="Trocar empresa" onClick={clear}>
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="search" style={{ margin: 0 }}>
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              placeholder="Buscar empresa ou lead por nome/CNPJ..."
              value={query}
              onChange={(e) => void handleSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
          {loading && <p className="sub" style={{ marginTop: 6 }}>Processando…</p>}
          {error && <div className="error-banner" style={{ marginTop: 6 }}>{error}</div>}

          {!loading && query.trim().length >= 2 && (
            <>
              <div className="co-results">
                {results.map((r) => (
                  <div key={`${r.origem}-${r.id}`} className="co-result" onClick={() => void handlePickResult(r)}>
                    <span className={`co-tag ${r.origem}`}>{r.origem}</span>
                    <div className="co-result-info">
                      <div className="co-result-nome">{r.nome}</div>
                      <div className="co-result-sub">
                        {r.cnpj ?? "sem CNPJ"}
                        {r.origem === "lead" ? " · na triagem" : ""}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: r.origem === "lead" ? "var(--accent-secondary)" : "var(--green)" }}>
                      {r.origem === "lead" ? "aprovar e vincular →" : "vincular →"}
                    </span>
                  </div>
                ))}
                {results.length === 0 && (
                  <div className="co-result-none">
                    <p>Nenhuma empresa ou lead encontrado para &quot;{query}&quot;.</p>
                  </div>
                )}
              </div>

              {/* Fora do .co-results (que tem scroll próprio) pra não ficar
                  escondido abaixo da rolagem quando a busca traz vários resultados. */}
              <div className="co-cnpj-box">
                <div className="field" style={{ margin: "0 0 8px" }}>
                  <label>Não encontrou? Cadastre a empresa sem sair da oportunidade</label>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ width: "100%" }}
                  onClick={() => setCadastrando(true)}
                >
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  Cadastrar &quot;{query}&quot; como empresa nova
                </button>
              </div>
            </>
          )}
        </>
      )}
      {modalCadastro}
    </div>
  );
}
