import Link from "next/link";
import type { ReactNode } from "react";
import { getServerAccessToken } from "@/lib/api/auth";
import { globalSearch, type GlobalSearchResult } from "@/lib/api/search";
import { effectiveTier, TIER_LABEL } from "@/lib/api/raw-leads";
import { taskTypeLabel } from "@/lib/api/tasks";
import { formatDateOnlyBR } from "@/lib/format-date";
import TopbarFilter from "@/app/_components/topbar-filter";

// Busca geral (pedido do usuário, 2026-09-03, no modelo da "Busca geral"
// do eGestor): um termo, resultados agrupados por seção, cada linha abre
// o registro. Quem decide o que aparece é o backend (GET /busca) — mesma
// visibilidade das telas de origem; seção que não vem é permissão que o
// usuário não tem.

const LEAD_STATUS_LABEL = {
  novo: "Em triagem",
  aprovado: "Aprovado",
  descartado: "Descartado",
} as const;

const OPP_STATUS = {
  open: { label: "Aberta", pill: "pill pill-blue" },
  won: { label: "Ganha", pill: "pill pill-green" },
  lost: { label: "Perdida", pill: "pill pill-red" },
} as const;

function brl(amount: string, currency: string): string {
  return Number(amount).toLocaleString("pt-BR", { style: "currency", currency: currency || "BRL" });
}

function Secao({
  titulo,
  itens,
  colunas,
  children,
}: {
  titulo: string;
  itens: unknown[] | undefined;
  colunas: string[];
  children: ReactNode;
}) {
  // undefined = sem permissão pra ver este módulo: a seção não existe pra
  // este usuário (não é "nenhum resultado").
  if (itens === undefined) return null;
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head">
        <h2>
          {titulo}
          <span className="sub" style={{ marginLeft: 8 }}>
            {itens.length === 0 ? "nenhum resultado" : `${itens.length} encontrado(s)`}
          </span>
        </h2>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.length === 0 ? (
            <tr>
              <td colSpan={colunas.length} className="empty">
                Nenhum resultado nesta seção.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

function totalDe(result: GlobalSearchResult): number {
  return (
    (result.empresas?.length ?? 0) +
    (result.contatos?.length ?? 0) +
    (result.prospeccao?.length ?? 0) +
    (result.pipeline?.length ?? 0) +
    (result.tarefas?.length ?? 0)
  );
}

export default async function BuscaGeralPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const token = await getServerAccessToken();
  const result = term.length >= 2 ? await globalSearch(token, term) : null;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Busca geral</div>
          <div className="page-sub">
            {result
              ? `${totalDe(result)} resultado(s) para "${term}"`
              : "Digite ao menos 2 letras e pressione Enter"}
          </div>
        </div>
        <TopbarFilter initialQuery={term} localFilter={false} />
      </div>

      <div className="content">
        {!result ? (
          <div className="empty">
            Busque por nome de empresa, CNPJ, cidade, contato, oportunidade ou tarefa. A busca
            olha Empresas, Contatos, Prospecção, Pipeline e Tarefas de uma vez.
          </div>
        ) : (
          <>
            <Secao titulo="Empresas" itens={result.empresas} colunas={["Empresa", "CNPJ", "Cidade/UF", "Classe"]}>
              {result.empresas?.map((e) => (
                <tr key={e.id} className="row-clickable">
                  <td>
                    <Link href={`/dashboard/empresas/${e.id}`} className="t-co">
                      {e.nome}
                    </Link>
                    {e.razaoSocial && e.razaoSocial !== e.nome && <div className="t-sub">{e.razaoSocial}</div>}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{e.cpfCnpj ?? "—"}</td>
                  <td>
                    {e.cidade ?? "—"}
                    {e.uf ? `/${e.uf}` : ""}
                  </td>
                  <td>{e.curvaAbc ? <span className="pill pill-gray">{e.curvaAbc}</span> : "—"}</td>
                </tr>
              ))}
            </Secao>

            <Secao titulo="Contatos" itens={result.contatos} colunas={["Contato", "Empresa", "Telefone", "E-mail"]}>
              {result.contatos?.map((c) => (
                <tr key={c.id} className="row-clickable">
                  <td>
                    <Link href={`/dashboard/empresas/${c.companyId}`} className="t-co">
                      {c.nome || "(sem nome)"}
                    </Link>
                    <div className="t-sub">
                      {c.cargo ?? "—"}
                      {c.decisor ? " · tomador de decisão" : ""}
                    </div>
                  </td>
                  <td>{c.empresa}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.telefone ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                </tr>
              ))}
            </Secao>

            <Secao titulo="Prospecção" itens={result.prospeccao} colunas={["Empresa", "CNPJ", "Cidade/UF", "Situação", "Qualificação"]}>
              {result.prospeccao?.map((l) => (
                <tr key={l.id} className="row-clickable">
                  <td>
                    <Link href={`/dashboard/leads/${l.id}`} className="t-co">
                      {l.razaoSocial}
                    </Link>
                    {l.segmento && <div className="t-sub">{l.segmento}</div>}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{l.cnpj ?? "—"}</td>
                  <td>
                    {l.municipio ?? "—"}
                    {l.uf ? `/${l.uf}` : ""}
                  </td>
                  <td>
                    <span className={l.status === "aprovado" ? "pill pill-green" : l.status === "descartado" ? "pill pill-gray" : "pill pill-blue"}>
                      {LEAD_STATUS_LABEL[l.status]}
                    </span>
                  </td>
                  <td>
                    <span className={`tier-tag tier-${effectiveTier(l)}`}>{l.score}</span>{" "}
                    <span className="t-sub" style={{ display: "inline" }}>
                      {TIER_LABEL[effectiveTier(l)]}
                    </span>
                  </td>
                </tr>
              ))}
            </Secao>

            <Secao titulo="Pipeline" itens={result.pipeline} colunas={["Empresa", "Etapa", "Valor", "Situação", "Previsão"]}>
              {result.pipeline?.map((o) => (
                <tr key={o.id} className="row-clickable">
                  <td>
                    <Link href={`/dashboard/pipeline/${o.id}`} className="t-co">
                      {o.empresa}
                    </Link>
                  </td>
                  <td>{o.etapa}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{brl(o.amount, o.currency)}</td>
                  <td>
                    <span className={OPP_STATUS[o.status].pill}>{OPP_STATUS[o.status].label}</span>
                  </td>
                  <td>{o.expectedCloseDate ? formatDateOnlyBR(o.expectedCloseDate) : "—"}</td>
                </tr>
              ))}
            </Secao>

            <Secao titulo="Tarefas" itens={result.tarefas} colunas={["Tarefa", "Tipo", "Empresa", "Prazo", "Situação"]}>
              {result.tarefas?.map((t) => (
                <tr key={t.id} className="row-clickable">
                  <td>
                    <Link href={`/dashboard/tarefas/${t.id}`} className="t-co">
                      {t.title}
                    </Link>
                  </td>
                  <td>{taskTypeLabel(t.tipo)}</td>
                  <td>{t.empresa ?? "—"}</td>
                  <td>{t.dueAt ? formatDateOnlyBR(t.dueAt) : "—"}</td>
                  <td>
                    <span className={t.status === "done" ? "pill pill-green" : "pill pill-gray"}>
                      {t.status === "done" ? "Concluída" : "Pendente"}
                    </span>
                  </td>
                </tr>
              ))}
            </Secao>
          </>
        )}
      </div>
    </>
  );
}
