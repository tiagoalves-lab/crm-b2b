"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDateBR } from "@/lib/format-date";
import { useTopbarQuery } from "@/app/_components/topbar-filter";
import ActionForm from "@/app/_components/action-form";
import ConfirmSubmitButton from "@/app/dashboard/(administracao)/membros/confirm-submit-button";
import { unconvertLeadFormAction } from "@/app/dashboard/leads/actions";

export interface ConvertidoRow {
  companyId: string;
  // Lead que deu origem à linha — é quem o "Desconverter" desfaz.
  leadId: string;
  nome: string;
  cpfCnpj: string | null;
  cidade: string | null;
  // Dono do lead. null = sem dono (carga antiga).
  representante: string | null;
  // null = conversão anterior ao registro de datas (set/2026, decisão 6.19).
  convertidoEm: string | null;
  propostas: number;
  // Qualquer oportunidade vinculada, inclusive da carga histórica — é a
  // trava do backend pra desconverter, então o ícone nem aparece.
  temOportunidade: boolean;
  ultimaProposta: string | null;
  // Interação mais recente da Timeline da empresa.
  ultimoContato: string | null;
}

// Mesmo comportamento da Carteira de clientes (empresas-table.tsx): clicar
// no título ordena, clicar de novo inverte, vazio vai sempre pro fim.
type SortKey = "empresa" | "cidade" | "representante" | "convertidoEm" | "propostas" | "ultimaProposta" | "ultimoContato";

// Datas e contagem começam DECRESCENTES: quem clica em "Conversão" quer o
// mais recente primeiro.
const PRIMEIRO_CLIQUE_DESC = new Set<SortKey>(["convertidoEm", "propostas", "ultimaProposta", "ultimoContato"]);

function valorDaColuna(row: ConvertidoRow, key: SortKey): string | number | null {
  switch (key) {
    case "empresa":
      return row.nome.toLowerCase();
    case "cidade":
      return row.cidade?.toLowerCase() ?? null;
    case "representante":
      return row.representante?.toLowerCase() ?? null;
    case "convertidoEm":
      return row.convertidoEm;
    case "propostas":
      return row.propostas;
    case "ultimaProposta":
      return row.ultimaProposta;
    case "ultimoContato":
      return row.ultimoContato;
  }
}

function ordenar(rows: ConvertidoRow[], key: SortKey, dir: "asc" | "desc"): ConvertidoRow[] {
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

// Fora do componente da tabela pelo mesmo motivo de empresas-table.tsx:
// definido dentro, remontaria os <th> a cada clique e perderia o foco.
function ThOrdenavel({
  coluna,
  label,
  sort,
  onOrdenar,
  title,
}: {
  coluna: SortKey;
  label: string;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onOrdenar: (coluna: SortKey) => void;
  title?: string;
}) {
  const ativa = sort.key === coluna;
  return (
    <th title={title} aria-sort={ativa ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" onClick={() => onOrdenar(coluna)}>
        {label}
        <span className={ativa ? "th-sort-seta ativa" : "th-sort-seta"}>
          {ativa ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

const traco = <span style={{ color: "var(--text-tertiary)" }}>—</span>;

export default function ConvertidosTable({ rows }: { rows: ConvertidoRow[] }) {
  const query = useTopbarQuery();
  // Começa pela conversão mais recente — é a fila que acabou de chegar.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "convertidoEm",
    dir: "desc",
  });

  const q = query.trim().toLowerCase();
  const filtradas = q ? rows.filter((r) => r.nome.toLowerCase().includes(q)) : rows;
  const visible = useMemo(() => ordenar(filtradas, sort.key, sort.dir), [filtradas, sort.key, sort.dir]);

  const alternarOrdem = (key: SortKey) =>
    setSort((atual) =>
      atual.key === key
        ? { key, dir: atual.dir === "asc" ? "desc" : "asc" }
        : { key, dir: PRIMEIRO_CLIQUE_DESC.has(key) ? "desc" : "asc" },
    );

  const th = (coluna: SortKey, label: string, title?: string) => (
    <ThOrdenavel key={coluna} coluna={coluna} label={label} sort={sort} onOrdenar={alternarOrdem} title={title} />
  );

  return (
    <div className="tabela-rolagem">
      <table className="data-table">
        <thead>
          <tr>
            {th("empresa", "Empresa")}
            {th("cidade", "Cidade")}
            {th("representante", "Representante")}
            {th("convertidoEm", "Conversão", "Data em que o lead saiu da triagem")}
            {th("propostas", "Propostas", "Propostas cadastradas no Pipeline (ciclo atual)")}
            {th("ultimaProposta", "Última proposta")}
            {th("ultimoContato", "Último contato", "Interação mais recente registrada na Timeline")}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.companyId} className="row-clickable">
              <td>
                <Link href={`/dashboard/empresas/${row.companyId}`} className="t-co">
                  {row.nome}
                </Link>
                <div className="t-sub">{row.cpfCnpj ?? "sem CPF/CNPJ"}</div>
              </td>
              <td>{row.cidade ?? traco}</td>
              <td>{row.representante ?? <span style={{ color: "var(--text-tertiary)" }}>sem dono</span>}</td>
              <td className="t-sub">
                {row.convertidoEm ? (
                  formatDateBR(row.convertidoEm)
                ) : (
                  <span title="Conversão anterior ao registro de datas (set/2026)">{traco}</span>
                )}
              </td>
              <td>
                {row.propostas > 0 ? (
                  row.propostas
                ) : (
                  <span className="pill pill-amber">
                    nenhuma
                  </span>
                )}
              </td>
              <td className="t-sub">{row.ultimaProposta ? formatDateBR(row.ultimaProposta) : traco}</td>
              <td className="t-sub">{row.ultimoContato ? formatDateBR(row.ultimoContato) : traco}</td>
              <td>
                <div className="cell-actions">
                  <Link href={`/dashboard/empresas/${row.companyId}`} className="icon-btn" title="Abrir ficha">
                    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </Link>
                  {/* Desconverter (2026-10-27): só aparece pra empresa sem
                      oportunidade nenhuma — com proposta, a conversão fica. */}
                  {!row.temOportunidade && (
                    <ActionForm action={unconvertLeadFormAction} onSuccess="stay">
                      <input type="hidden" name="id" value={row.leadId} />
                      <ConfirmSubmitButton
                        className="icon-btn"
                        title="Desconverter lead"
                        confirmMessage={`Desconverter ${row.nome}? O lead volta para a Prospecção e sai desta lista.`}
                      >
                        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 7v6h6" />
                          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                        </svg>
                      </ConfirmSubmitButton>
                    </ActionForm>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={8} className="empty">
                {q ? `Nenhuma empresa encontrada para "${query}".` : "Nenhum lead convertido aguardando venda."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
