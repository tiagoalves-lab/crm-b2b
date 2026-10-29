import Link from "next/link";
import type { ReactNode } from "react";
import {
  getConsultaNotas,
  type ConsultaCfop,
  type ConsultaEmpresa,
  type ConsultaItem,
  type ConsultaMes,
  type ConsultaNota,
  type ConsultaNotas,
  type VisaoConsulta,
} from "@/lib/api/fiscal";
import { brlOuZero, dataBR, documentoBR, nomeEstab, NUM, numeroBR, PAGINA, Situacao } from "./formato";
import ExportarConsulta from "./exportar-consulta";
import FiltrosConsulta from "./filtros-consulta";
import { CHAVES_EXTRAS, faixaConsulta, MESES_NOME } from "./periodo-consulta";

// Aba "Consultar notas" (pedido do usuário, 2026-10-28; modelo aprovado no
// mesmo dia): pesquisa livre em todas as notas da base. Filtros em cima
// (filtros-consulta.tsx), resultado embaixo por nota, item, empresa, CFOP
// ou mês. Os totais somam só as notas que valem (a cancelada aparece mas
// não soma, como no Resumo de notas emitidas).

const VISOES: { valor: VisaoConsulta; rotulo: string }[] = [
  { valor: "nota", rotulo: "Nota" },
  { valor: "item", rotulo: "Item" },
  { valor: "empresa", rotulo: "Empresa" },
  { valor: "cfop", rotulo: "CFOP" },
  { valor: "mes", rotulo: "Mês" },
];

// Origem da mercadoria (1º dígito do CST do ICMS) — aparece no mouse.
const ORIGEM_MERC: Record<string, string> = {
  "0": "Nacional",
  "1": "Estrangeira, importação direta",
  "2": "Estrangeira, comprada no mercado interno",
  "3": "Nacional, conteúdo de importação acima de 40% e até 70%",
  "4": "Nacional, produção pelos processos produtivos básicos",
  "5": "Nacional, conteúdo de importação até 40%",
  "6": "Estrangeira, importação direta, sem similar nacional",
  "7": "Estrangeira, mercado interno, sem similar nacional",
  "8": "Nacional, conteúdo de importação acima de 70%",
};

const CST_ICMS: Record<string, string> = {
  "00": "Tributada integralmente",
  "02": "Tributação monofásica própria",
  "10": "Tributada e com cobrança do ICMS por ST",
  "15": "Monofásica própria e com retenção",
  "20": "Com redução de base de cálculo",
  "30": "Isenta ou não tributada e com cobrança por ST",
  "40": "Isenta",
  "41": "Não tributada",
  "50": "Suspensão",
  "51": "Diferimento",
  "53": "Monofásica com recolhimento diferido",
  "60": "ICMS cobrado anteriormente por ST",
  "61": "Monofásica cobrada anteriormente",
  "70": "Com redução de base e cobrança por ST",
  "90": "Outras",
  "101": "Simples Nacional, com permissão de crédito",
  "102": "Simples Nacional, sem permissão de crédito",
  "103": "Simples Nacional, isenção por faixa de receita",
  "201": "Simples Nacional, com crédito e cobrança por ST",
  "202": "Simples Nacional, sem crédito e com cobrança por ST",
  "203": "Simples Nacional, isenção e cobrança por ST",
  "300": "Simples Nacional, imune",
  "400": "Simples Nacional, não tributada",
  "500": "Simples Nacional, ICMS cobrado anteriormente por ST",
  "900": "Simples Nacional, outros",
};

// "—" = não se aplica (ICMS/IPI de NFS-e); zero aparece como 0,00.
const valor = (v: string | null | undefined) => (v === null || v === undefined ? "—" : numeroBR(v));
const pct = (v: string | null | undefined) => (v === null || v === undefined ? "—" : `${numeroBR(v)}%`);
const csv = (v: string | null | undefined) => (v === null || v === undefined ? "" : numeroBR(v));
const qtd = (v: string | null) =>
  v === null ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const nomeMes = (mes: string) => `${MESES_NOME[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;
const docRotulo = (d: string) => (d === "nfse" ? "NFS-e" : "NF-e");

function Origem({ sentido }: { sentido: string | null }) {
  if (sentido === "entrada") return <span className="consulta-entrada">Entrada</span>;
  if (sentido === "saida") return <span className="consulta-saida">Saída</span>;
  return <>—</>;
}

interface Coluna<T> {
  titulo: string;
  num?: boolean;
  dica?: string;
  // Só na planilha: na tela a informação já está dentro de outra célula.
  planilha?: boolean;
  celula: (r: T) => ReactNode;
  csv: (r: T) => string;
}

const COLUNAS_NOTA: Coluna<ConsultaNota>[] = [
  { titulo: "Data", celula: (n) => dataBR(n.dataEmissao), csv: (n) => dataBR(n.dataEmissao) },
  {
    titulo: "Nota",
    celula: (n) => (
      <>
        <span className="consulta-mono">{n.numero ?? "—"}</span>
        <div className="t-sub">
          {docRotulo(n.doc)}
          {n.emitente === "terceiro" && " · recebida"}
        </div>
        {n.resumo && (
          <span className="pill pill-gray" title="O eGestor só tem o resumo (falta dar ciência): sem itens nem impostos">
            Só resumo
          </span>
        )}
        {n.transferencia && <span className="pill pill-blue">Transferência</span>}
      </>
    ),
    csv: (n) => String(n.numero ?? ""),
  },
  { titulo: "Doc.", planilha: true, celula: () => null, csv: (n) => docRotulo(n.doc) + (n.emitente === "terceiro" ? " recebida" : "") },
  { titulo: "Estab.", celula: (n) => nomeEstab(n.estabelecimento), csv: (n) => nomeEstab(n.estabelecimento) },
  { titulo: "Origem", celula: (n) => <Origem sentido={n.sentido} />, csv: (n) => n.sentido ?? "" },
  {
    titulo: "Empresa",
    celula: (n) => (
      <>
        {n.empresa ?? "—"}
        <div className="t-sub consulta-mono">
          {documentoBR(n.documento)}
          {n.uf ? ` · ${n.uf}` : ""}
        </div>
      </>
    ),
    csv: (n) => n.empresa ?? "",
  },
  { titulo: "CNPJ/CPF", planilha: true, celula: () => null, csv: (n) => documentoBR(n.documento) },
  { titulo: "CFOP", celula: (n) => <span className="consulta-mono">{n.cfops ?? "—"}</span>, csv: (n) => n.cfops ?? "" },
  {
    titulo: "Itens",
    celula: (n) =>
      n.primeiroItem ? (
        <span className="consulta-item" title={n.primeiroItem}>
          {n.primeiroItem}
          {n.itens > 1 && <span className="t-sub"> +{n.itens - 1}</span>}
        </span>
      ) : (
        "—"
      ),
    csv: (n) => n.primeiroItem ?? "",
  },
  { titulo: "ICMS", num: true, celula: (n) => valor(n.vIcms), csv: (n) => csv(n.vIcms) },
  { titulo: "IPI", num: true, celula: (n) => valor(n.vIpi), csv: (n) => csv(n.vIpi) },
  { titulo: "PIS", num: true, celula: (n) => valor(n.vPis), csv: (n) => csv(n.vPis) },
  { titulo: "COFINS", num: true, celula: (n) => valor(n.vCofins), csv: (n) => csv(n.vCofins) },
  { titulo: "Total", num: true, celula: (n) => brlOuZero(n.total), csv: (n) => csv(n.total) },
  { titulo: "Situação", celula: (n) => <Situacao valor={n.situacao} />, csv: (n) => n.situacao },
];

const COLUNAS_ITEM: Coluna<ConsultaItem>[] = [
  { titulo: "Data", celula: (i) => dataBR(i.dataEmissao), csv: (i) => dataBR(i.dataEmissao) },
  {
    titulo: "Nota",
    celula: (i) => (
      <>
        <span className="consulta-mono">{i.numero ?? "—"}</span>
        <div className="t-sub">
          {docRotulo(i.doc)}
          {i.emitente === "terceiro" && " · recebida"}
        </div>
      </>
    ),
    csv: (i) => String(i.numero ?? ""),
  },
  { titulo: "Origem", celula: (i) => <Origem sentido={i.sentido} />, csv: (i) => i.sentido ?? "" },
  { titulo: "Empresa", celula: (i) => i.empresa ?? "—", csv: (i) => i.empresa ?? "" },
  {
    titulo: "Item",
    celula: (i) => (
      <>
        <span className="consulta-item" title={i.descricao ?? ""}>
          {i.descricao ?? "—"}
        </span>
        {i.codigo && <div className="t-sub consulta-mono">{i.codigo}</div>}
      </>
    ),
    csv: (i) => i.descricao ?? "",
  },
  { titulo: "Código", planilha: true, celula: () => null, csv: (i) => i.codigo ?? "" },
  {
    titulo: "NCM / serviço",
    celula: (i) => <span className="consulta-mono">{i.ncm ?? i.servico ?? "—"}</span>,
    csv: (i) => i.ncm ?? i.servico ?? "",
  },
  {
    titulo: "CFOP",
    celula: (i) => (
      <span className="consulta-mono" title={i.cfopDescricao ?? undefined}>
        {i.cfop ?? "—"}
      </span>
    ),
    csv: (i) => i.cfop ?? "",
  },
  {
    titulo: "Orig. merc.",
    dica: "Origem da mercadoria (1º dígito do CST do ICMS)",
    celula: (i) => (
      <span className="consulta-mono" title={i.origem ? ORIGEM_MERC[i.origem] : undefined}>
        {i.origem ?? "—"}
      </span>
    ),
    csv: (i) => i.origem ?? "",
  },
  {
    titulo: "CST",
    celula: (i) => (
      <span className="consulta-mono" title={i.cst ? CST_ICMS[i.cst] : undefined}>
        {i.cst ?? "—"}
      </span>
    ),
    csv: (i) => i.cst ?? "",
  },
  { titulo: "Qtd.", num: true, celula: (i) => qtd(i.quantidade), csv: (i) => qtd(i.quantidade) },
  { titulo: "Valor", num: true, celula: (i) => brlOuZero(i.valor), csv: (i) => csv(i.valor) },
  { titulo: "BC ICMS", num: true, celula: (i) => valor(i.bcIcms), csv: (i) => csv(i.bcIcms) },
  { titulo: "% ICMS", num: true, celula: (i) => pct(i.pIcms), csv: (i) => csv(i.pIcms) },
  { titulo: "Vlr ICMS", num: true, celula: (i) => valor(i.vIcms), csv: (i) => csv(i.vIcms) },
  { titulo: "% IPI", num: true, celula: (i) => pct(i.pIpi), csv: (i) => csv(i.pIpi) },
  { titulo: "Vlr IPI", num: true, celula: (i) => valor(i.vIpi), csv: (i) => csv(i.vIpi) },
  { titulo: "Situação", celula: (i) => <Situacao valor={i.situacao} />, csv: (i) => i.situacao },
];

const COLUNAS_EMPRESA: Coluna<ConsultaEmpresa>[] = [
  { titulo: "Empresa", celula: (e) => e.empresa ?? "—", csv: (e) => e.empresa ?? "" },
  {
    titulo: "CNPJ/CPF",
    celula: (e) => <span className="consulta-mono">{documentoBR(e.documento) || "—"}</span>,
    csv: (e) => documentoBR(e.documento),
  },
  { titulo: "UF", celula: (e) => e.uf ?? "—", csv: (e) => e.uf ?? "" },
  { titulo: "Notas", num: true, celula: (e) => e.notas, csv: (e) => String(e.notas) },
  { titulo: "Saída", num: true, celula: (e) => brlOuZero(e.saida), csv: (e) => csv(e.saida) },
  { titulo: "Entrada", num: true, celula: (e) => brlOuZero(e.entrada), csv: (e) => csv(e.entrada) },
  { titulo: "ICMS", num: true, celula: (e) => valor(e.vIcms), csv: (e) => csv(e.vIcms) },
  { titulo: "IPI", num: true, celula: (e) => valor(e.vIpi), csv: (e) => csv(e.vIpi) },
  { titulo: "PIS", num: true, celula: (e) => valor(e.vPis), csv: (e) => csv(e.vPis) },
  { titulo: "COFINS", num: true, celula: (e) => valor(e.vCofins), csv: (e) => csv(e.vCofins) },
];

const COLUNAS_CFOP: Coluna<ConsultaCfop>[] = [
  { titulo: "CFOP", celula: (c) => <span className="consulta-mono">{c.cfop ?? "—"}</span>, csv: (c) => c.cfop ?? "" },
  {
    titulo: "Descrição",
    celula: (c) => (c.cfop ? (c.descricao ?? "CFOP sem cadastro") : "Serviço (NFS-e)"),
    csv: (c) => (c.cfop ? (c.descricao ?? "CFOP sem cadastro") : "Serviço (NFS-e)"),
  },
  { titulo: "Notas", num: true, celula: (c) => c.notas, csv: (c) => String(c.notas) },
  { titulo: "Itens", num: true, celula: (c) => c.itens, csv: (c) => String(c.itens) },
  { titulo: "Valor dos itens", num: true, celula: (c) => brlOuZero(c.valor), csv: (c) => csv(c.valor) },
  { titulo: "ICMS", num: true, celula: (c) => valor(c.vIcms), csv: (c) => csv(c.vIcms) },
  { titulo: "IPI", num: true, celula: (c) => valor(c.vIpi), csv: (c) => csv(c.vIpi) },
];

const COLUNAS_MES: Coluna<ConsultaMes>[] = [
  { titulo: "Mês", celula: (m) => nomeMes(m.mes), csv: (m) => nomeMes(m.mes) },
  { titulo: "Notas", num: true, celula: (m) => m.notas, csv: (m) => String(m.notas) },
  { titulo: "Saída", num: true, celula: (m) => brlOuZero(m.saida), csv: (m) => csv(m.saida) },
  { titulo: "Entrada", num: true, celula: (m) => brlOuZero(m.entrada), csv: (m) => csv(m.entrada) },
  { titulo: "ICMS", num: true, celula: (m) => valor(m.vIcms), csv: (m) => csv(m.vIcms) },
  { titulo: "IPI", num: true, celula: (m) => valor(m.vIpi), csv: (m) => csv(m.vIpi) },
  { titulo: "PIS", num: true, celula: (m) => valor(m.vPis), csv: (m) => csv(m.vPis) },
  { titulo: "COFINS", num: true, celula: (m) => valor(m.vCofins), csv: (m) => csv(m.vCofins) },
];

export default async function ConsultaNotasTela({
  token,
  params,
}: {
  token: string;
  params: Record<string, string | undefined>;
}) {
  const faixa = faixaConsulta(params.periodo, params.inicio, params.fim);
  const ver: VisaoConsulta = VISOES.some((v) => v.valor === params.ver) ? (params.ver as VisaoConsulta) : "nota";

  const filtro: Record<string, string> = { inicio: faixa.inicio, fim: faixa.fim, ver };
  for (const k of ["empresa", "numero", "item", ...CHAVES_EXTRAS]) {
    const v = params[k]?.trim();
    if (v) filtro[k] = v;
  }
  const dados = await getConsultaNotas(token, filtro);

  // O que a barra de filtros precisa pra começar igual à URL.
  const inicial: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v) inicial[k] = v;

  // "Ver por" troca só a visão; o resto da querystring continua.
  const hrefVisao = (v: VisaoConsulta) => {
    const q = new URLSearchParams();
    for (const [k, valorParam] of Object.entries(params)) if (valorParam && k !== "ver") q.set(k, valorParam);
    q.set("r", "consulta");
    if (v !== "nota") q.set("ver", v);
    return `${PAGINA}?${q.toString()}`;
  };

  const r = dados.resumo;

  return (
    <>
      <FiltrosConsulta inicial={inicial} />

      <div className="panel">
        <div className="panel-head consulta-resultado-head">
          <div className="panel-title">
            Resultado
            <span className="t-sub">
              {dataBR(dados.inicio)} a {dataBR(dados.fim)}
            </span>
          </div>
          <div className="consulta-resultado-acoes">
            <span className="consulta-rotulo">Ver por</span>
            <div className="seg" role="group" aria-label="Ver resultado por">
              {VISOES.map((v) => (
                <Link
                  key={v.valor}
                  href={hrefVisao(v.valor)}
                  className={v.valor === ver ? "active" : undefined}
                  aria-current={v.valor === ver ? "true" : undefined}
                >
                  {v.rotulo}
                </Link>
              ))}
            </div>
            <ExportarConsulta
              linhas={linhasPlanilha(dados)}
              nome={`notas-${ver}-${dados.inicio}-a-${dados.fim}.csv`}
            />
          </div>
        </div>
        <div className="panel-body">
          <div className="stat-grid stat-grid-compacto">
            <div className="stat-tile">
              <div className="stat-label">Notas</div>
              <div className="stat-value">{r.notas.toLocaleString("pt-BR")}</div>
              <div className="sub">
                {r.foraDaSoma > 0 ? `${r.foraDaSoma} fora da soma (canceladas etc.)` : "todas somam"}
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Saída</div>
              <div className="stat-value">{brlOuZero(r.saida)}</div>
              <div className="sub">{r.notasSaida} nota(s)</div>
            </div>
            <div className="stat-tile purple">
              <div className="stat-label">Entrada</div>
              <div className="stat-value">{brlOuZero(r.entrada)}</div>
              <div className="sub">{r.notasEntrada} nota(s)</div>
            </div>
            <div className="stat-tile green">
              <div className="stat-label">ICMS + IPI</div>
              <div className="stat-value">{brlOuZero(String(Number(r.vIcms) + Number(r.vIpi)))}</div>
              <div className="sub">destacado nas notas</div>
            </div>
          </div>

          {dados.truncado && (
            <p className="field-hint" style={{ marginBottom: 12 }}>
              A pesquisa achou mais linhas do que a tabela mostra de uma vez (5.000). Os cartões acima valem para
              tudo; estreite os filtros para ver o restante.
            </p>
          )}

          <div className="fiscal-tabela">
            <Tabela dados={dados} />
          </div>
          <p className="field-hint" style={{ marginTop: 10 }}>
            Origem é do ponto de vista da Gama: a venda de um fornecedor aparece como entrada. Nota cancelada aparece
            na lista, mas não entra nos totais.
          </p>
        </div>
      </div>
    </>
  );
}

function colunasDa(ver: VisaoConsulta) {
  return (
    {
      nota: COLUNAS_NOTA,
      item: COLUNAS_ITEM,
      empresa: COLUNAS_EMPRESA,
      cfop: COLUNAS_CFOP,
      mes: COLUNAS_MES,
    } as Record<VisaoConsulta, Coluna<never>[]>
  )[ver];
}

function Tabela({ dados }: { dados: ConsultaNotas }) {
  const colunas = (colunasDa(dados.ver) as Coluna<unknown>[]).filter((c) => !c.planilha);
  return (
    <table className="data-table consulta-tabela">
      <thead>
        <tr>
          {colunas.map((c) => (
            <th key={c.titulo} style={c.num ? NUM : undefined} title={c.dica}>
              {c.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dados.rows.length === 0 ? (
          <tr>
            <td colSpan={colunas.length} className="t-sub" style={{ textAlign: "center", padding: 32 }}>
              Nenhuma nota com esses filtros.
            </td>
          </tr>
        ) : (
          dados.rows.map((linha, i) => (
            <tr key={i}>
              {colunas.map((c) => (
                <td key={c.titulo} style={c.num ? NUM : undefined}>
                  {c.celula(linha)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
      {dados.rows.length > 0 && <Rodape dados={dados} colunas={colunas.map((c) => c.titulo)} />}
    </table>
  );
}

// Linha de total: a mesma soma dos cartões (só o que vale), na coluna certa.
function Rodape({ dados, colunas }: { dados: ConsultaNotas; colunas: string[] }) {
  const r = dados.resumo;
  const t = dados.totalItens;
  const valores: Record<string, ReactNode> =
    dados.ver === "item" && t
      ? { Valor: brlOuZero(t.valor), "BC ICMS": valor(t.bcIcms), "Vlr ICMS": valor(t.vIcms), "Vlr IPI": valor(t.vIpi) }
      : dados.ver === "nota"
        ? { ICMS: valor(r.vIcms), IPI: valor(r.vIpi), PIS: valor(r.vPis), COFINS: valor(r.vCofins), Total: brlOuZero(r.total) }
        : dados.ver === "cfop"
          ? {}
          : {
              Notas: r.notas - r.foraDaSoma,
              Saída: brlOuZero(r.saida),
              Entrada: brlOuZero(r.entrada),
              ICMS: valor(r.vIcms),
              IPI: valor(r.vIpi),
              PIS: valor(r.vPis),
              COFINS: valor(r.vCofins),
            };
  if (Object.keys(valores).length === 0) return null;
  return (
    <tfoot>
      <tr>
        {colunas.map((c, i) => (
          <td key={c} style={c in valores ? NUM : undefined}>
            {i === 0 ? "Total (só o que soma)" : (valores[c] ?? "")}
          </td>
        ))}
      </tr>
    </tfoot>
  );
}

function linhasPlanilha(dados: ConsultaNotas): string[][] {
  const colunas = colunasDa(dados.ver) as Coluna<unknown>[];
  return [colunas.map((c) => c.titulo), ...dados.rows.map((linha) => colunas.map((c) => c.csv(linha)))];
}
