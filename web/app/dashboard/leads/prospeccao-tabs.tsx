"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Contact, RawLead } from "@/lib/api/types";
import {
  effectiveTier,
  ETAPA_COR,
  FAIXA_FUNIL_LABEL,
  FAIXA_FUNIL_PILL,
  TIER_LABEL,
  type ScoreTier,
} from "@/lib/api/raw-leads";
import { formatDateBR } from "@/lib/format-date";
import { normalizeForFilter, useTopbarQuery } from "@/app/_components/topbar-filter";
import { leadBateComBusca } from "./filtro";
import FiltroModal, {
  contarFiltros,
  FILTRO_VAZIO,
  leadPassaNoFiltro,
  type FiltroTags,
} from "./filtro-modal";
import LeadsTable from "./leads-table";
import ProspeccaoKanban from "./prospeccao-kanban";

// Abas da Prospecção do lado do CLIENTE (2026-09-18, depois de o usuário
// reclamar que "a navegação entre as opções de leads está travando"):
// cada aba era um Link com querystring, então trocar de aba refazia a
// página no servidor inteira — 878 leads, os contatos deles e as
// oportunidades, de novo, só pra mudar um filtro sobre dados que já
// estavam na tela. Agora a troca é estado no navegador, sem ida ao
// servidor. Os filtros de tag/segmento continuam em querystring (eles
// mudam o conjunto que o servidor monta).
export type Aba = "prospects" | "qualificados" | "convertidos" | "descartados";

// Lista × Kanban (2026-09-23, pedido do usuário: "crie um ícone de visão
// que nem a Auvo Sistemas, onde posso ver no modo lista e também no modo
// de Kanban"). A escolha fica gravada no navegador de quem usa — quem
// trabalha no quadro não quer reabrir a tela na lista todo dia.
type Visao = "lista" | "kanban";

const VISAO_KEY = "prospeccao-visao";

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
  aprovados,
  descartados,
  convertidos,
  contactsByCompanyId,
  nomePorUserId,
  tagsDisponiveis,
  segmentosDisponiveis,
}: {
  abaInicial: Aba;
  novos: RawLead[];
  // Leads convertidos como LEAD (não a linha agregada por empresa de
  // `convertidos`) — é o que o quadro põe na coluna Negociação/Fechamento.
  aprovados: RawLead[];
  descartados: RawLead[];
  convertidos: ConvertidoRow[];
  contactsByCompanyId: Record<string, Contact[]>;
  nomePorUserId: Record<string, string>;
  // Todas as tags/segmentos que existem na Prospecção — o modal de filtro
  // precisa da lista inteira, não só a da aba aberta (senão uma tag que
  // só aparece em Descartados some do filtro quando se está em Prospects).
  tagsDisponiveis: string[];
  segmentosDisponiveis: string[];
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  // Filtro de tags/segmentos (2026-09-24). Era querystring com uma tag
  // por vez, o que recarregava a tela inteira a cada clique; virou estado
  // no navegador pra valer também no quadro e responder na hora.
  const [filtro, setFiltro] = useState<FiltroTags>(FILTRO_VAZIO);
  const [filtroAberto, setFiltroAberto] = useState(false);
  const filtrosAtivos = contarFiltros(filtro);
  // Começa sempre na lista e só troca depois de ler o navegador: ler
  // localStorage no primeiro render quebraria a hidratação do Next (o
  // servidor não tem como saber a escolha).
  const [visao, setVisao] = useState<Visao>("lista");
  useEffect(() => {
    try {
      const salva = window.localStorage.getItem(VISAO_KEY);
      if (salva === "kanban" || salva === "lista") setVisao(salva);
    } catch {
      // navegador sem storage (janela privada): fica na lista, sem quebrar
    }
  }, []);
  function trocarVisao(nova: Visao) {
    setVisao(nova);
    try {
      window.localStorage.setItem(VISAO_KEY, nova);
    } catch {
      // idem
    }
  }
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
  const bate = (lead: RawLead) =>
    leadPassaNoFiltro(lead, filtro) && leadBateComBusca(lead, needle, contactsByCompanyId);

  // Quem separa as abas é a ETAPA do funil (2026-09-23), não mais a
  // presença de prazo — senão lista e quadro discordariam: um cartão
  // puxado de Qualificado de volta pra Andamento no quadro continuaria
  // na aba "Leads qualificados" da lista, porque o prazo segue gravado.
  const prospects = novos.filter((r) => r.etapa !== "qualificado" && bate(r));
  const qualificados = novos.filter((r) => r.etapa === "qualificado" && bate(r));
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

  const baseToda = useMemo(
    () => [...novos, ...aprovados, ...descartados],
    [novos, aprovados, descartados],
  );
  const { contagemPorTag, contagemPorSegmento, semTagTotal } = useMemo(() => {
    const porTag: Record<string, number> = {};
    const porSegmento: Record<string, number> = {};
    let semTag = 0;
    for (const lead of baseToda) {
      if (lead.tags.length === 0) semTag += 1;
      for (const tag of lead.tags) porTag[tag] = (porTag[tag] ?? 0) + 1;
      if (lead.segmento) porSegmento[lead.segmento] = (porSegmento[lead.segmento] ?? 0) + 1;
    }
    return { contagemPorTag: porTag, contagemPorSegmento: porSegmento, semTagTotal: semTag };
  }, [baseToda]);

  // Cartões do quadro: triagem + convertidos, na mesma busca da lista.
  // Descartado fica de fora — saiu do funil e tem aba própria.
  const leadsDoQuadro = useMemo(
    () => [...novos, ...aprovados].filter((l) => bate(l)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [novos, aprovados, needle, contactsByCompanyId, filtro],
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
        {visao === "lista" ? (
          <div className="seg">
            {tab("prospects", `Prospects (${contagem.prospects})`)}
            {tab("qualificados", `Leads qualificados (${contagem.qualificados})`)}
            {tab("convertidos", `Leads convertidos (${contagem.convertidos})`)}
            {tab("descartados", `Descartados (${contagem.descartados})`)}
          </div>
        ) : (
          // No quadro as abas dariam o mesmo recorte duas vezes (cada aba
          // já é uma coluna). Fica só o atalho pros descartados, que não
          // têm coluna porque saíram do funil.
          <div className="seg">
            <button type="button" onClick={() => trocarVisao("lista")}>
              Descartados ({contagem.descartados})
            </button>
          </div>
        )}
        <button
          type="button"
          className={filtrosAtivos > 0 ? "btn btn-sm filtro-btn ativo" : "btn btn-sm filtro-btn"}
          onClick={() => setFiltroAberto(true)}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 5h18l-7 8v5l-4 2v-7z" />
          </svg>
          {filtrosAtivos > 0 ? `Filtros: ${filtrosAtivos}` : "Filtros"}
        </button>
        <div className="visao-toggle" role="group" aria-label="Modo de visualização">
          <button
            type="button"
            className={visao === "lista" ? "active" : undefined}
            onClick={() => trocarVisao("lista")}
            title="Ver em lista"
            aria-label="Ver em lista"
            aria-pressed={visao === "lista"}
          >
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          </button>
          <button
            type="button"
            className={visao === "kanban" ? "active" : undefined}
            onClick={() => trocarVisao("kanban")}
            title="Ver em quadro (Kanban)"
            aria-label="Ver em quadro (Kanban)"
            aria-pressed={visao === "kanban"}
          >
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="6" height="16" rx="1" />
              <rect x="10.5" y="4" width="6" height="11" rx="1" />
              <rect x="18" y="4" width="3" height="16" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {filtroAberto && (
        <FiltroModal
          tagsDisponiveis={tagsDisponiveis}
          segmentosDisponiveis={segmentosDisponiveis}
          contagemPorTag={contagemPorTag}
          contagemPorSegmento={contagemPorSegmento}
          semTagTotal={semTagTotal}
          valor={filtro}
          onAplicar={(novo) => {
            setFiltro(novo);
            setFiltroAberto(false);
          }}
          onFechar={() => setFiltroAberto(false)}
        />
      )}

      {/* O que está filtrado fica à vista fora do modal: o filtro agora
          mora dentro de uma janela que se fecha, e sem isto quem volta à
          tela depois vê uma lista curta sem saber o motivo. Cada pastilha
          tira o próprio filtro, sem reabrir o modal. */}
      {filtrosAtivos > 0 && (
        <div className="tag-filter-row">
          {filtro.semTag && (
            <button
              type="button"
              className="tag-chip active"
              onClick={() => setFiltro((a) => ({ ...a, semTag: false }))}
            >
              Sem tag ✕
            </button>
          )}
          {filtro.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="tag-chip active"
              onClick={() =>
                setFiltro((a) => ({ ...a, tags: a.tags.filter((t) => t !== tag) }))
              }
            >
              {tag} ✕
            </button>
          ))}
          {filtro.segmentos.map((segmento) => (
            <button
              key={segmento}
              type="button"
              className="tag-chip active"
              onClick={() =>
                setFiltro((a) => ({ ...a, segmentos: a.segmentos.filter((s) => s !== segmento) }))
              }
            >
              {segmento} ✕
            </button>
          ))}
          {filtro.tags.length > 1 && (
            <span className="t-sub" style={{ alignSelf: "center" }}>
              {filtro.modo === "todas" ? "todas ao mesmo tempo" : "qualquer uma"}
            </span>
          )}
          <button type="button" className="tag-chip" onClick={() => setFiltro(FILTRO_VAZIO)}>
            Limpar filtros
          </button>
        </div>
      )}

      {visao === "kanban" && (
        <ProspeccaoKanban
          leads={leadsDoQuadro}
          contactsByCompanyId={contactsByCompanyId}
          nomePorUserId={nomePorUserId}
          cores={ETAPA_COR}
        />
      )}

      {visao === "lista" && pulouPara && (
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

      {visao === "lista" && abaEfetiva === "qualificados" && (
        <div className="tag-filter-row">
          {chip(null, "Todos os prazos")}
          {chip("quente", `${TIER_LABEL.quente} (${porPrazo("quente")})`)}
          {chip("morno", `${TIER_LABEL.morno} (${porPrazo("morno")})`)}
          {chip("frio", `${TIER_LABEL.frio} (${porPrazo("frio")})`)}
        </div>
      )}

      {visao === "lista" &&
        (abaEfetiva === "convertidos" ? (
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
                        <span className={FAIXA_FUNIL_PILL.negociacao}>
                          {FAIXA_FUNIL_LABEL.negociacao}
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
        ))}
    </>
  );
}
