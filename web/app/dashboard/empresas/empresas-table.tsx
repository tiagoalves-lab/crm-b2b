"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { companyRazaoSocialName } from "@/lib/api/companies";
import type { Company } from "@/lib/api/types";
import { formatDateBR } from "@/lib/format-date";
import { deleteCompanyAction, restoreCompanyAction } from "./actions";
import SubmitButton from "@/app/_components/submit-button";

export type Tipo = "lead" | "cliente";
export type Classe = "A" | "B" | "C";

export interface EmpresaRow {
  company: Company;
  tipo: Tipo;
  // Classe da curva ABC gravada na empresa. null = sem compra, ou curva
  // nunca calculada (o botão "Calcular curva ABC" é quem preenche).
  classe: Classe | null;
  ltv: number;
  ultimaCompra: string | null;
}

// A é quem sustenta o faturamento e C é a ponta longa — as cores seguem
// essa leitura (verde/âmbar/azul), não um juízo de "bom/ruim".
const CLASSE_PILL: Record<Classe, string> = {
  A: "pill pill-green",
  B: "pill pill-amber",
  C: "pill pill-blue",
};

function brl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

// Primeira coluna mostra razão social (igual ao protótipo, clienteRows()
// usa c.razao) — ver companyRazaoSocialName em lib/api/companies.ts.
function primaryName(company: Company): string {
  return companyRazaoSocialName(company);
}

// ── Ordenação (pedido do usuário, 2026-08-21) ────────────────────────────
// Clicar no título da coluna ordena por ela; clicar de novo inverte. Fica
// no navegador (não na querystring) porque a lista inteira já vem pro
// client — mesmo critério da busca por nome logo acima.
type SortKey = "empresa" | "tipo" | "egestor" | "cidade" | "classe" | "ltv" | "ultimaCompra";

// Colunas de dinheiro e data começam DECRESCENTES no primeiro clique: quem
// clica em "LTV" quer ver quem mais comprou, não quem menos comprou.
const PRIMEIRO_CLIQUE_DESC = new Set<SortKey>(["ltv", "ultimaCompra"]);

// `null` aqui quer dizer "célula vazia" (o traço na tela) — essas linhas
// vão sempre pro fim, nas duas direções. Empresa sem cidade no meio da
// lista de cidades só atrapalha a leitura.
function valorDaColuna(row: EmpresaRow, key: SortKey): string | number | null {
  switch (key) {
    case "empresa":
      return primaryName(row.company).toLowerCase();
    case "tipo":
      return row.tipo;
    case "egestor":
      return row.company.egestorContato ? 0 : 1;
    case "cidade":
      return row.company.cidade
        ? `${row.company.cidade}${row.company.uf ?? ""}`.toLowerCase()
        : null;
    case "classe":
      return row.classe;
    case "ltv":
      return row.ltv > 0 ? row.ltv : null;
    case "ultimaCompra":
      return row.ultimaCompra;
  }
}

// Cabeçalho clicável. Fora do componente da tabela de propósito: definido
// dentro, o React o trataria como um tipo novo a cada render e remontaria
// os <th> a cada clique — o foco do teclado se perderia logo depois de
// ordenar. O <button> por dentro é o que faz a coluna responder ao teclado
// também, não só ao mouse; `aria-sort` é o que o leitor de tela anuncia.
function ThOrdenavel({
  coluna,
  label,
  sort,
  onOrdenar,
  alinharDireita,
  title,
}: {
  coluna: SortKey;
  label: string;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onOrdenar: (coluna: SortKey) => void;
  alinharDireita?: boolean;
  title?: string;
}) {
  const ativa = sort.key === coluna;
  return (
    <th
      title={title}
      aria-sort={ativa ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      style={{ textAlign: alinharDireita ? "right" : undefined }}
    >
      <button type="button" className="th-sort" onClick={() => onOrdenar(coluna)}>
        {label}
        <span className={ativa ? "th-sort-seta ativa" : "th-sort-seta"}>
          {ativa ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function ordenar(rows: EmpresaRow[], key: SortKey, dir: "asc" | "desc"): EmpresaRow[] {
  const fator = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = valorDaColuna(a, key);
    const vb = valorDaColuna(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * fator;
    return String(va).localeCompare(String(vb), "pt-BR") * fator;
  });
}

// Toolbar (seg + busca) e tabela vivem no mesmo client component porque a
// busca por nome (client-side, como no protótipo — gama-crm-mvp.html,
// filterClientes()) precisa filtrar a mesma lista que a tabela renderiza.
// O filtro Todas/Leads/Clientes e "Ver excluídas" continuam em querystring
// (mesmo padrão do resto do app — ver leads-table.tsx), só a busca de texto
// é estado efêmero no navegador.
export default function EmpresasTable({
  rows,
  currentFiltro,
  showDeleted,
  counts,
  canDelete,
}: {
  rows: EmpresaRow[];
  currentFiltro: "todas" | "lead" | "cliente";
  showDeleted: boolean;
  counts: { todas: number; lead: number; cliente: number };
  canDelete: boolean;
}) {
  const [query, setQuery] = useState("");
  // Começa como a lista já chegava do servidor: alfabética pela empresa.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "empresa",
    dir: "asc",
  });

  const q = query.trim().toLowerCase();
  const filtradas = q
    ? rows.filter((r) => primaryName(r.company).toLowerCase().includes(q))
    : rows;
  const visible = useMemo(
    () => ordenar(filtradas, sort.key, sort.dir),
    [filtradas, sort.key, sort.dir],
  );

  const alternarOrdem = (key: SortKey) =>
    setSort((atual) =>
      atual.key === key
        ? { key, dir: atual.dir === "asc" ? "desc" : "asc" }
        : { key, dir: PRIMEIRO_CLIQUE_DESC.has(key) ? "desc" : "asc" },
    );

  const th = (
    coluna: SortKey,
    label: string,
    opcoes: { alinharDireita?: boolean; title?: string } = {},
  ) => (
    <ThOrdenavel
      key={coluna}
      coluna={coluna}
      label={label}
      sort={sort}
      onOrdenar={alternarOrdem}
      {...opcoes}
    />
  );

  const filtroHref = (f: "todas" | "lead" | "cliente") =>
    `/dashboard/empresas?filtro=${f}${showDeleted ? "&includeDeleted=1" : ""}`;
  const deletedHref = showDeleted
    ? `/dashboard/empresas?filtro=${currentFiltro}`
    : `/dashboard/empresas?filtro=${currentFiltro}&includeDeleted=1`;

  return (
    <>
      <div className="toolbar">
        <div className="seg">
          <Link href={filtroHref("todas")} className={currentFiltro === "todas" ? "active" : undefined}>
            Todas ({counts.todas})
          </Link>
          <Link href={filtroHref("lead")} className={currentFiltro === "lead" ? "active" : undefined}>
            Leads ({counts.lead})
          </Link>
          <Link href={filtroHref("cliente")} className={currentFiltro === "cliente" ? "active" : undefined}>
            Clientes ({counts.cliente})
          </Link>
        </div>
        <div className="search">
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar empresa..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Link href={deletedHref} className="btn btn-ghost btn-sm">
          {showDeleted ? "Ocultar excluídas" : "Ver excluídas"}
        </Link>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            {th("empresa", "Empresa")}
            {th("tipo", "Tipo")}
            {th("egestor", "eGestor", {
              title: "Tem vínculo com o eGestor (Matriz e/ou Filial)",
            })}
            {th("cidade", "Cidade")}
            {th("classe", "Classe")}
            {th("ltv", "LTV", { alinharDireita: true })}
            {th("ultimaCompra", "Última compra")}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ company, tipo, classe, ltv, ultimaCompra }) => (
            <tr key={company.id} className="row-clickable">
              <td>
                <Link href={`/dashboard/empresas/${company.id}`} className="t-co">
                  {primaryName(company)}
                </Link>
                <div className="t-sub">{company.cpfCnpj ?? "sem CPF/CNPJ"}</div>
              </td>
              <td>
                <span className={tipo === "cliente" ? "pill pill-green" : "pill pill-blue"}>
                  {tipo === "cliente" ? "Cliente" : "Lead"}
                </span>
              </td>
              <td style={{ textAlign: "center" }}>
                {company.egestorContato ? (
                  <span title="Integrada com o eGestor" style={{ color: "var(--green)" }}>
                    ✓
                  </span>
                ) : (
                  <span title="Sem vínculo com o eGestor" style={{ color: "var(--text-tertiary)" }}>
                    ✗
                  </span>
                )}
              </td>
              <td>
                {company.cidade ? `${company.cidade}${company.uf ? `/${company.uf}` : ""}` : "—"}
              </td>
              <td>
                {classe ? (
                  <span
                    className={CLASSE_PILL[classe]}
                    title="Curva ABC — peso desta empresa no faturamento acumulado"
                  >
                    {classe}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-tertiary)" }}>—</span>
                )}
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  color: ltv > 0 ? "var(--green)" : "var(--text-tertiary)",
                }}
              >
                {ltv > 0 ? brl(ltv) : "—"}
              </td>
              <td className="t-sub">
                {ultimaCompra ? formatDateBR(ultimaCompra) : "—"}
              </td>
              <td>
                <div className="cell-actions">
                  <Link href={`/dashboard/empresas/${company.id}`} className="icon-btn" title="Abrir ficha">
                    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </Link>
                  <Link href={`/dashboard/empresas/${company.id}/editar`} className="icon-btn" title="Editar">
                    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </Link>
                  {company.deletedAt ? (
                    <form action={restoreCompanyAction}>
                      <input type="hidden" name="id" value={company.id} />
                      <SubmitButton className="icon-btn" title="Restaurar">
                        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      </SubmitButton>
                    </form>
                  ) : (
                    canDelete && (
                      <form action={deleteCompanyAction}>
                        <input type="hidden" name="id" value={company.id} />
                        <SubmitButton className="icon-btn danger" title="Excluir">
                          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                          </svg>
                        </SubmitButton>
                      </form>
                    )
                  )}
                </div>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={8} className="empty">
                {q ? `Nenhuma empresa encontrada para "${query}".` : "Nenhuma empresa encontrada."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
