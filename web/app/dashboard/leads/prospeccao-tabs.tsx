"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Contact, RawLead } from "@/lib/api/types";
import {
  effectiveTier,
  FAIXA_FUNIL_LABEL,
  FAIXA_FUNIL_PILL,
  TIER_LABEL,
  type ScoreTier,
} from "@/lib/api/raw-leads";
import { formatDateBR } from "@/lib/format-date";
import { normalizeForFilter, useTopbarQuery } from "@/app/_components/topbar-filter";
import { leadBateComBusca } from "./filtro";
import LeadsTable from "./leads-table";

// Abas da Prospecção do lado do CLIENTE (2026-09-18, depois de o usuário
// reclamar que "a navegação entre as opções de leads está travando"):
// cada aba era um Link com querystring, então trocar de aba refazia a
// página no servidor inteira — 878 leads, os contatos deles e as
// oportunidades, de novo, só pra mudar um filtro sobre dados que já
// estavam na tela. Agora a troca é estado no navegador, sem ida ao
// servidor. Os filtros de tag/segmento continuam em querystring (eles
// mudam o conjunto que o servidor monta).
export type Aba = "prospects" | "qualificados" | "convertidos" | "descartados";

export interface ConvertidoRow {
  companyId: string;
  nome: string;
  abertas: number;
  ganhas: number;
  perdidas: number;
  valorAberto: number;
  ultimoMovimento: string | null;
}

const brl = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const ABA_LABEL: Record<Aba, string> = {
  prospects: "Prospects",
  qualificados: "Leads qualificados",
  convertidos: "Leads convertidos",
  descartados: "Descartados",
};

export default function ProspeccaoTabs({
  abaInicial,
  novos,
  descartados,
  convertidos,
  contactsByCompanyId,
  nomePorUserId,
}: {
  abaInicial: Aba;
  novos: RawLead[];
  descartados: RawLead[];
  convertidos: ConvertidoRow[];
  contactsByCompanyId: Record<string, Contact[]>;
  nomePorUserId: Record<string, string>;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  // null = "todos os prazos" dentro de Leads qualificados.
  const [prazo, setPrazo] = useState<ScoreTier | null>(null);

  // Busca do cabeçalho (2026-09-18, furo achado pelo usuário: "no filtro
  // geral a empresa consta no prospect, mas dentro do prospect o filtro
  // não relaciona a empresa"). Duas coisas faltavam:
  //   1. A aba Leads convertidos não filtrava NADA — é tabela própria,
  //      fora do LeadsTable, e ninguém tinha ligado o filtro nela.
  //   2. A contagem das abas ignorava a busca, então a aba aberta dizia
  //      "nenhum lead bate" sem dizer onde o resultado estava.
  // Agora a contagem é a dos resultados e a busca pula pra aba que tem o
  // registro (ver abaEfetiva abaixo).
  const needle = normalizeForFilter(useTopbarQuery().trim());
  const bate = (lead: RawLead) => leadBateComBusca(lead, needle, contactsByCompanyId);

  const prospects = novos.filter((r) => effectiveTier(r) === null && bate(r));
  const qualificados = novos.filter((r) => effectiveTier(r) !== null && bate(r));
  const descartadosVisiveis = descartados.filter(bate);
  const convertidosVisiveis = useMemo(
    () =>
      needle ? convertidos.filter((r) => normalizeForFilter(r.nome).includes(needle)) : convertidos,
    [convertidos, needle],
  );
  const porPrazo = (t: ScoreTier) => qualificados.filter((r) => effectiveTier(r) === t).length;

  const contagem: Record<Aba, number> = {
    prospects: prospects.length,
    qualificados: qualificados.length,
    convertidos: convertidosVisiveis.length,
    descartados: descartadosVisiveis.length,
  };

  // A busca PULA pra aba que tem o resultado (2026-09-21, bug relatado
  // pelo usuário: buscou uma empresa que é lead convertido estando em
  // Prospects e a tela não mostrou nada). Antes a aba vazia só apontava
  // onde estava o registro, e ele tinha que clicar — buscar e não achar
  // é um bug, mesmo com a dica ao lado.
  //
  // É aba EFETIVA, não troca de estado: `aba` continua sendo a escolha da
  // pessoa, então limpar a busca volta sozinho pra aba onde ela estava.
  // Ordem de preferência: a ordem do funil.
  const ORDEM: Aba[] = ["prospects", "qualificados", "convertidos", "descartados"];
  const pulouPara =
    needle !== "" && contagem[aba] === 0
      ? (ORDEM.find((a) => a !== aba && contagem[a] > 0) ?? null)
      : null;
  const abaEfetiva: Aba = pulouPara ?? aba;

  const rows =
    abaEfetiva === "prospects"
      ? prospects
      : abaEfetiva === "qualificados"
        ? qualificados.filter((r) => prazo === null || effectiveTier(r) === prazo)
        : abaEfetiva === "descartados"
          ? descartadosVisiveis
          : [];

  // Outras abas que também têm resultado — atalho, já que o pulo escolhe
  // uma só.
  const outrasComResultado = (Object.keys(contagem) as Aba[]).filter(
    (a) => a !== abaEfetiva && contagem[a] > 0,
  );

  const tab = (alvo: Aba, label: string) => (
    <button
      type="button"
      className={abaEfetiva === alvo ? "active" : undefined}
      onClick={() => setAba(alvo)}
    >
      {label}
    </button>
  );

  const chip = (alvo: ScoreTier | null, label: string) => (
    <button
      type="button"
      className={prazo === alvo ? "tag-chip active" : "tag-chip"}
      onClick={() => setPrazo(alvo)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="toolbar">
        <div className="seg">
          {tab("prospects", `Prospects (${contagem.prospects})`)}
          {tab("qualificados", `Leads qualificados (${contagem.qualificados})`)}
          {tab("convertidos", `Leads convertidos (${contagem.convertidos})`)}
          {tab("descartados", `Descartados (${contagem.descartados})`)}
        </div>
      </div>

      {pulouPara && (
        <div className="aba-dica">
          <span>
            Nada em <b>{ABA_LABEL[aba]}</b> bate com a busca — mostrando{" "}
            <b>{ABA_LABEL[pulouPara]}</b>.
          </span>
          {outrasComResultado.length > 0 && (
            <>
              {" Também tem em: "}
              {outrasComResultado.map((a, i) => (
                <span key={a}>
                  {i > 0 && " · "}
                  <button type="button" className="tag-chip" onClick={() => setAba(a)}>
                    {ABA_LABEL[a]} ({contagem[a]})
                  </button>
                </span>
              ))}
            </>
          )}
        </div>
      )}

      {abaEfetiva === "qualificados" && (
        <div className="tag-filter-row">
          {chip(null, "Todos os prazos")}
          {chip("quente", `${TIER_LABEL.quente} (${porPrazo("quente")})`)}
          {chip("morno", `${TIER_LABEL.morno} (${porPrazo("morno")})`)}
          {chip("frio", `${TIER_LABEL.frio} (${porPrazo("frio")})`)}
        </div>
      )}

      {abaEfetiva === "convertidos" ? (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                {/* Mesma coluna Funil das outras visões (2026-09-21). Aqui
                    a faixa é sempre a mesma, mas a coluna fica assim mesmo:
                    quem chega nesta aba vem pulando da busca e precisa ver
                    em que faixa caiu. */}
                <th>Funil</th>
                <th>Empresa</th>
                <th>Em negociação</th>
                <th>Ganhas</th>
                <th>Perdidas</th>
                <th style={{ textAlign: "right" }}>Valor em negociação</th>
                <th>Último movimento</th>
              </tr>
            </thead>
            <tbody>
              {convertidosVisiveis.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ color: "var(--text-secondary)" }}>
                    {needle ? "Nenhuma empresa bate com o filtro." : "Nenhum lead convertido ainda."}
                  </td>
                </tr>
              ) : (
                convertidosVisiveis.map((row) => {
                  const semProposta = row.abertas + row.ganhas + row.perdidas === 0;
                  return (
                    <tr key={row.companyId}>
                      <td>
                        <span className={FAIXA_FUNIL_PILL.convertido}>
                          {FAIXA_FUNIL_LABEL.convertido}
                        </span>
                      </td>
                      <td className="row-clickable">
                        <Link href={`/dashboard/empresas/${row.companyId}`} className="t-co">
                          {row.nome}
                        </Link>
                        {semProposta && <div className="t-sub">proposta ainda não cadastrada</div>}
                      </td>
                      <td>{row.abertas || "—"}</td>
                      <td>{row.ganhas || "—"}</td>
                      <td>{row.perdidas || "—"}</td>
                      <td style={{ textAlign: "right" }}>{row.valorAberto > 0 ? brl(row.valorAberto) : "—"}</td>
                      <td>{row.ultimoMovimento ? formatDateBR(row.ultimoMovimento) : "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <LeadsTable
          rows={rows}
          readOnly={abaEfetiva === "descartados"}
          contactsByCompanyId={contactsByCompanyId}
          nomePorUserId={nomePorUserId}
        />
      )}
    </>
  );
}
