"use client";

import Link from "next/link";
import { useState } from "react";
import { companyDisplayName, formatPhoneBR } from "@/lib/api/companies";
import type { Company } from "@/lib/api/types";
import { deleteCompanyAction, restoreCompanyAction } from "./actions";

export type Status = "ativo" | "negociando";
export type Tipo = "lead" | "cliente";

export interface EmpresaRow {
  company: Company;
  tipo: Tipo;
  status: Status;
  ltv: number;
  ultimaCompra: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  ativo: "ativo",
  negociando: "negociando",
};
const STATUS_PILL: Record<Status, string> = {
  ativo: "pill pill-green",
  negociando: "pill pill-amber",
};

function brl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
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
}: {
  rows: EmpresaRow[];
  currentFiltro: "todas" | "lead" | "cliente";
  showDeleted: boolean;
  counts: { todas: number; lead: number; cliente: number };
}) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => companyDisplayName(r.company).toLowerCase().includes(q))
    : rows;

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
            <th>Empresa</th>
            <th>Tipo</th>
            <th>Contato</th>
            <th>Cidade</th>
            <th>Status</th>
            <th style={{ textAlign: "right" }}>LTV</th>
            <th>Última compra</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ company, tipo, status, ltv, ultimaCompra }) => (
            <tr key={company.id} className="row-clickable">
              <td>
                <Link href={`/dashboard/empresas/${company.id}`} className="t-co">
                  {companyDisplayName(company)}
                </Link>
                <div className="t-sub">{company.cpfCnpj ?? "sem CPF/CNPJ"}</div>
              </td>
              <td>
                <span className={tipo === "cliente" ? "pill pill-green" : "pill pill-blue"}>
                  {tipo === "cliente" ? "Cliente" : "Lead"}
                </span>
              </td>
              <td>
                {company.nomeParaContato ? (
                  <>
                    {company.nomeParaContato}
                    <div className="t-sub">{formatPhoneBR(company.fones[0]) ?? "—"}</div>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {company.cidade ? `${company.cidade}${company.uf ? `/${company.uf}` : ""}` : "—"}
              </td>
              <td>
                <span className={STATUS_PILL[status]}>{STATUS_LABEL[status]}</span>
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
                {ultimaCompra ? new Date(ultimaCompra).toLocaleDateString("pt-BR") : "—"}
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
                      <button type="submit" className="icon-btn" title="Restaurar">
                        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      </button>
                    </form>
                  ) : (
                    <form action={deleteCompanyAction}>
                      <input type="hidden" name="id" value={company.id} />
                      <button type="submit" className="icon-btn danger" title="Excluir">
                        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                        </svg>
                      </button>
                    </form>
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
