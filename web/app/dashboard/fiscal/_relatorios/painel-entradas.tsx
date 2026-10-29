"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import type { ClasseEntrada, ItemEntrada, NotaEntrada, RegistroClassificacao } from "@/lib/api/fiscal";
import { formatDateTimeBR } from "@/lib/format-date";
import { classificarEntradaAction } from "../actions";
import {
  classeDaNota,
  GRUPOS_CLASSE,
  rotuloClasse,
  situacaoDaNota,
  sugestaoDaNota,
  type SituacaoClassificacao,
} from "./classes-entrada";
import { brlOuZero, dataBR, nomeEstab, numeroBR, NUM, semAcento } from "./formato";

// Notas de entrada (decisão 7.8): cada nota com a classificação dos itens.
// Na linha, a classificação vale pra nota inteira (todos os itens); na
// ficha lateral dá pra classificar item a item. Quando o CFOP diz o que a
// nota é, ou o fornecedor já foi classificado antes, a tela sugere e a
// pessoa só confirma. A tela muda na hora e o servidor confirma em seguida
// — se recusar, a mensagem aparece em cima e a nota volta.

type Classificacao = { chave: string; itens: number[]; classe: ClasseEntrada | null; observacao?: string };
type Estado = { rows: NotaEntrada[]; historico: RegistroClassificacao[] };

const LANCAMENTO = {
  sim: { rotulo: "Lançada", classe: "pill pill-green" },
  nao: { rotulo: "Não lançada", classe: "pill pill-red" },
  propria: { rotulo: "Nota própria", classe: "pill pill-gray" },
} as const;

const AJUDA_LANCAMENTO = {
  sim: "Lançada como compra no eGestor.",
  nao: "Não foi lançada como compra no eGestor.",
  propria: "Nota de entrada emitida pela própria Gama no eGestor (importação, devolução, retorno).",
} as const;

// Filtros que os cards ligam e desligam.
type Card = "" | "nao-lancada" | SituacaoClassificacao;

// Ordenação pelo cabeçalho da tabela (pedido do usuário, 2026-10-27), no
// molde da tela Empresas. Sem clique, fica a ordem que vem do servidor.
type Coluna = "data" | "nf" | "estab" | "fornecedor" | "operacao" | "valor" | "egestor" | "classe";
type Ordem = { coluna: Coluna; dir: "asc" | "desc" } | null;

// Data e valor começam do maior: o mais recente e a nota mais cara.
const PRIMEIRO_CLIQUE_DESC = new Set<Coluna>(["data", "valor"]);

function valorDaColuna(n: NotaEntrada, coluna: Coluna): string | number | null {
  switch (coluna) {
    case "data":
      return n.dataEmissao;
    case "nf":
      return n.numero ?? null;
    case "estab":
      return nomeEstab(n.estabelecimento);
    case "fornecedor":
      return n.fornecedor ? semAcento(n.fornecedor) : null;
    case "operacao":
      return [n.itens[0]?.cfop, n.natureza].filter(Boolean).join(" ") || null;
    case "valor":
      return n.valor === null ? null : Number(n.valor);
    case "egestor":
      return LANCAMENTO[n.lancamento].rotulo;
    case "classe": {
      const classe = classeDaNota(n.itens);
      return classe === null ? null : classe === "varias" ? "Várias" : rotuloClasse(classe);
    }
  }
}

// Vazio vai sempre pro fim, nos dois sentidos.
function ordenar(rows: NotaEntrada[], ordem: Ordem): NotaEntrada[] {
  if (!ordem) return rows;
  const fator = ordem.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = valorDaColuna(a, ordem.coluna);
    const vb = valorDaColuna(b, ordem.coluna);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * fator;
    return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * fator;
  });
}

// Fora do componente da tabela pelo mesmo motivo da tela Empresas: definido
// dentro, o React remontaria o <th> a cada clique e o foco se perderia.
function ThOrdenavel({
  coluna,
  label,
  ordem,
  onOrdenar,
  style,
}: {
  coluna: Coluna;
  label: string;
  ordem: Ordem;
  onOrdenar: (coluna: Coluna) => void;
  style?: React.CSSProperties;
}) {
  const ativa = ordem?.coluna === coluna;
  return (
    <th aria-sort={ativa ? (ordem.dir === "asc" ? "ascending" : "descending") : "none"} style={style}>
      <button type="button" className="th-sort" onClick={() => onOrdenar(coluna)}>
        {label}
        <span className={ativa ? "th-sort-seta ativa" : "th-sort-seta"}>
          {ativa ? (ordem.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export default function PainelEntradas({
  rows,
  historico,
  podeEditar,
}: {
  rows: NotaEntrada[];
  historico: RegistroClassificacao[];
  podeEditar: boolean;
}) {
  const [estado, aplicar] = useOptimistic<Estado, Classificacao>({ rows, historico }, reduzir);
  const [, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [operacao, setOperacao] = useState("");
  const [lancamento, setLancamento] = useState("");
  const [filtroClasse, setFiltroClasse] = useState("");
  const [card, setCard] = useState<Card>("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<Ordem>(null);

  const alternarOrdem = (coluna: Coluna) =>
    setOrdem((atual) =>
      atual?.coluna === coluna
        ? { coluna, dir: atual.dir === "asc" ? "desc" : "asc" }
        : { coluna, dir: PRIMEIRO_CLIQUE_DESC.has(coluna) ? "desc" : "asc" },
    );

  function classificar(dados: Classificacao) {
    setErro(null);
    startTransition(async () => {
      aplicar(dados);
      const r = await classificarEntradaAction({
        chave: dados.chave,
        itens: dados.itens,
        classe: dados.classe,
        observacao: dados.observacao,
      });
      if (r.erro) setErro(r.erro);
    });
  }

  // Confirma a sugestão de cada item ainda sem classificação (os itens de
  // uma nota podem ter sugestões diferentes).
  function confirmarSugestao(nota: NotaEntrada) {
    const porClasse = new Map<ClasseEntrada, number[]>();
    for (const item of nota.itens) {
      if (item.classe || !item.sugestao) continue;
      porClasse.set(item.sugestao, [...(porClasse.get(item.sugestao) ?? []), item.nItem]);
    }
    for (const [classe, itens] of porClasse) classificar({ chave: nota.chave, itens, classe });
  }

  const situacoes = useMemo(
    () => new Map(estado.rows.map((n) => [n.chave, situacaoDaNota(n.itens)] as const)),
    [estado.rows],
  );

  // Operação = CFOP dos itens, com a natureza da primeira nota que usa.
  const operacoes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const n of estado.rows)
      for (const i of n.itens) if (i.cfop && !mapa.has(i.cfop)) mapa.set(i.cfop, n.natureza ?? "");
    return [...mapa].sort((a, b) => a[0].localeCompare(b[0]));
  }, [estado.rows]);

  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    const filtradas = estado.rows.filter((n) => {
      const situacao = situacoes.get(n.chave);
      if (termo) {
        const texto = semAcento(
          [n.fornecedor, n.numero, n.natureza, n.documento, ...n.itens.flatMap((i) => [i.descricao, i.cfop, i.ncm])]
            .filter(Boolean)
            .join(" "),
        );
        if (!texto.includes(termo)) return false;
      }
      if (operacao && !n.itens.some((i) => i.cfop === operacao)) return false;
      if (lancamento && n.lancamento !== lancamento) return false;
      if (filtroClasse) {
        if (filtroClasse.startsWith("__")) {
          if (filtroClasse === "__varias" ? classeDaNota(n.itens) !== "varias" : situacao !== filtroClasse.slice(2))
            return false;
        } else if (!n.itens.some((i) => i.classe === filtroClasse)) return false;
      }
      if (card === "nao-lancada" && n.lancamento !== "nao") return false;
      if (card && card !== "nao-lancada" && situacao !== card) return false;
      return true;
    });
    return ordenar(filtradas, ordem);
  }, [estado.rows, situacoes, busca, operacao, lancamento, filtroClasse, card, ordem]);

  const th = (coluna: Coluna, label: string, style?: React.CSSProperties) => (
    <ThOrdenavel coluna={coluna} label={label} ordem={ordem} onOrdenar={alternarOrdem} style={style} />
  );

  const notaAberta = estado.rows.find((n) => n.chave === aberta) ?? null;

  return (
    <>
      {erro && (
        <div className="error-banner" role="alert" style={{ marginBottom: 12 }}>
          {erro}{" "}
          <button type="button" className="vinculo-desfazer" onClick={() => setErro(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      <Cards rows={estado.rows} situacoes={situacoes} ativo={card} onClick={(c) => setCard(card === c ? "" : c)} />

      <div className="entradas-filtros">
        <input
          className="entradas-busca"
          type="search"
          placeholder="Buscar fornecedor, nota, item, operação ou CFOP…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar"
        />
        <select value={operacao} onChange={(e) => setOperacao(e.target.value)} aria-label="Operação">
          <option value="">Operação: todas</option>
          {operacoes.map(([cfop, natureza]) => (
            <option key={cfop} value={cfop}>
              {cfop} · {natureza}
            </option>
          ))}
        </select>
        <select value={lancamento} onChange={(e) => setLancamento(e.target.value)} aria-label="No eGestor">
          <option value="">eGestor: todas</option>
          <option value="nao">Não lançada</option>
          <option value="sim">Lançada</option>
          <option value="propria">Nota própria</option>
        </select>
        <select value={filtroClasse} onChange={(e) => setFiltroClasse(e.target.value)} aria-label="Classificação">
          <option value="">Classificação: todas</option>
          <option value="__pendente">Sem classificação</option>
          <option value="__sugerida">Sugerida, a confirmar</option>
          <option value="__varias">Itens com classificações diferentes</option>
          {GRUPOS_CLASSE.map((g) => (
            <optgroup key={g.grupo} label={g.grupo}>
              {g.classes.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="panel fiscal-tabela">
        <table className="data-table entradas-tabela">
          <thead>
            <tr>
              {th("data", "Data")}
              {th("nf", "NF")}
              {th("estab", "Estab.")}
              {th("fornecedor", "Fornecedor")}
              {th("operacao", "CFOP · Item")}
              {th("valor", "Valor", NUM)}
              {th("egestor", "No eGestor")}
              {th("classe", "Classificação")}
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr>
                <td colSpan={8} className="t-sub" style={{ textAlign: "center", padding: 28 }}>
                  Nenhuma nota com esses filtros.
                </td>
              </tr>
            ) : (
              visiveis.map((n) => (
                <LinhaNota
                  key={n.chave}
                  nota={n}
                  situacao={situacoes.get(n.chave)!}
                  podeEditar={podeEditar}
                  onAbrir={() => setAberta(n.chave)}
                  onClassificar={(classe) =>
                    classificar({ chave: n.chave, itens: n.itens.map((i) => i.nItem), classe })
                  }
                  onConfirmar={() => confirmarSugestao(n)}
                />
              ))
            )}
          </tbody>
          {visiveis.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5}>
                  {visiveis.length} de {estado.rows.length} nota(s)
                </td>
                <td style={NUM}>{brlOuZero(String(visiveis.reduce((s, n) => s + Number(n.valor ?? 0), 0)))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {notaAberta && (
        <FichaNota
          nota={notaAberta}
          historico={estado.historico.filter((h) => h.chave === notaAberta.chave)}
          podeEditar={podeEditar}
          onFechar={() => setAberta(null)}
          onClassificar={(itens, classe, observacao) =>
            classificar({ chave: notaAberta.chave, itens, classe, observacao })
          }
        />
      )}
    </>
  );
}

function reduzir(estado: Estado, c: Classificacao): Estado {
  const alvo = new Set(c.itens);
  return {
    rows: estado.rows.map((n) =>
      n.chave !== c.chave
        ? n
        : { ...n, itens: n.itens.map((i) => (alvo.has(i.nItem) ? { ...i, classe: c.classe } : i)) },
    ),
    historico: [
      ...estado.historico,
      ...c.itens.map((nItem) => ({
        chave: c.chave,
        nItem,
        classe: c.classe,
        observacao: c.observacao ?? null,
        origem: "tela" as const,
        autor: "Você",
        criadoEm: new Date().toISOString(),
      })),
    ],
  };
}

function Cards({
  rows,
  situacoes,
  ativo,
  onClick,
}: {
  rows: NotaEntrada[];
  situacoes: Map<string, SituacaoClassificacao>;
  ativo: Card;
  onClick: (c: Card) => void;
}) {
  const somar = (lista: NotaEntrada[]) => brlOuZero(String(lista.reduce((s, n) => s + Number(n.valor ?? 0), 0)));
  const de = (s: SituacaoClassificacao) => rows.filter((n) => situacoes.get(n.chave) === s);
  const cards: { chave: Card; rotulo: string; cor: string; lista: NotaEntrada[]; ajuda: string }[] = [
    { chave: "", rotulo: "Notas de entrada", cor: "", lista: rows, ajuda: "Todas as notas do período" },
    {
      chave: "nao-lancada",
      rotulo: "Não lançadas no eGestor",
      cor: "danger",
      lista: rows.filter((n) => n.lancamento === "nao"),
      ajuda: "Recebidas que não foram lançadas como compra no eGestor",
    },
    {
      chave: "pendente",
      rotulo: "Sem classificação",
      cor: "danger",
      lista: de("pendente"),
      ajuda: "Notas com item sem classificação e sem sugestão",
    },
    {
      chave: "sugerida",
      rotulo: "Sugeridas p/ confirmar",
      cor: "purple",
      lista: de("sugerida"),
      ajuda: "O CRM sugeriu pelo CFOP ou pelo histórico do fornecedor — falta confirmar",
    },
    {
      chave: "classificada",
      rotulo: "Classificadas",
      cor: "green",
      lista: de("classificada"),
      ajuda: "Todos os itens classificados",
    },
  ];
  return (
    <div className="stat-grid stat-grid-compacto">
      {cards.map((c) => (
        <button
          key={c.chave || "todas"}
          type="button"
          className={`stat-tile entradas-card ${c.cor}${ativo === c.chave ? " ativo" : ""}`}
          title={c.ajuda}
          onClick={() => onClick(c.chave)}
          aria-pressed={ativo === c.chave}
        >
          <div className="stat-label">{c.rotulo}</div>
          <div className="stat-value">{c.lista.length}</div>
          <div className="sub">{somar(c.lista)}</div>
        </button>
      ))}
    </div>
  );
}

function OpcoesClasse() {
  return (
    <>
      {GRUPOS_CLASSE.map((g) => (
        <optgroup key={g.grupo} label={g.grupo}>
          {g.classes.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function LinhaNota({
  nota,
  situacao,
  podeEditar,
  onAbrir,
  onClassificar,
  onConfirmar,
}: {
  nota: NotaEntrada;
  situacao: SituacaoClassificacao;
  podeEditar: boolean;
  onAbrir: () => void;
  onClassificar: (classe: ClasseEntrada | null) => void;
  onConfirmar: () => void;
}) {
  const primeiro = nota.itens[0];
  const classe = classeDaNota(nota.itens);
  const sugestao = situacao === "sugerida" ? sugestaoDaNota(nota.itens) : null;
  const sugerindo = situacao === "sugerida" && classe === null;
  const valorSelect = classe === "varias" ? "__varias" : (classe ?? (sugerindo && sugestao ? sugestao : ""));
  const estilo = sugerindo ? "sugerida" : situacao === "pendente" && classe === null ? "vazia" : "";
  const motivo = nota.itens.find((i) => !i.classe && i.sugestao)?.sugestaoMotivo;

  return (
    <tr className="entradas-linha" onClick={onAbrir}>
      <td className="t-mono">{dataBR(nota.dataEmissao)}</td>
      <td className="t-mono">{nota.numero ?? "—"}</td>
      <td>{nomeEstab(nota.estabelecimento)}</td>
      <td>
        <div className="entradas-forn" title={nota.fornecedor ?? ""}>
          {nota.fornecedor ?? "—"}
        </div>
        <div className="t-sub">{nota.uf ?? ""}</div>
      </td>
      <td>
        <div className="entradas-op">
          {primeiro?.cfop && <span className="entradas-cfop">{primeiro.cfop}</span>}
          {nota.natureza ?? "—"}
        </div>
        <div className="t-sub entradas-op">
          {primeiro ? primeiro.descricao : "Só o resumo no eGestor (sem a ciência da nota)"}
          {nota.itens.length > 1 && <span className="badge"> +{nota.itens.length - 1}</span>}
        </div>
      </td>
      <td style={NUM}>{brlOuZero(nota.valor)}</td>
      <td>
        <span className={LANCAMENTO[nota.lancamento].classe} title={AJUDA_LANCAMENTO[nota.lancamento]}>
          {LANCAMENTO[nota.lancamento].rotulo}
        </span>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        {situacao === "sem-itens" ? (
          <span className="t-sub">Sem itens</span>
        ) : (
          <>
            <div className="entradas-classe">
              <select
                className={estilo}
                value={valorSelect}
                disabled={!podeEditar}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__varias") return;
                  onClassificar(v ? (v as ClasseEntrada) : null);
                }}
                aria-label={`Classificação da NF ${nota.numero ?? ""}`}
              >
                <option value="">— classificar —</option>
                {classe === "varias" && (
                  <option value="__varias" disabled>
                    Várias (ver itens)
                  </option>
                )}
                <OpcoesClasse />
              </select>
              {sugerindo && podeEditar && (
                <button type="button" className="entradas-confirmar" onClick={onConfirmar}>
                  Confirmar
                </button>
              )}
            </div>
            {sugerindo && (
              <div className="entradas-sugestao">
                {sugestao ? "Sugerida" : "Sugestões diferentes por item"} pelo{" "}
                {motivo === "fornecedor" ? "fornecedor" : "CFOP"}
              </div>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

const pct = (v: string | null) =>
  v === null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const qtd = (v: string | null) =>
  v === null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const valorOuTraco = (v: string | null) => (v === null ? "—" : numeroBR(v));

function FichaNota({
  nota,
  historico,
  podeEditar,
  onFechar,
  onClassificar,
}: {
  nota: NotaEntrada;
  historico: RegistroClassificacao[];
  podeEditar: boolean;
  onFechar: () => void;
  onClassificar: (itens: number[], classe: ClasseEntrada | null, observacao?: string) => void;
}) {
  const [aba, setAba] = useState<"classificacao" | "itens" | "historico">("classificacao");
  const classeAtual = classeDaNota(nota.itens);
  const sugestao = sugestaoDaNota(nota.itens);
  const [classe, setClasse] = useState<string>(
    classeAtual === "varias" ? "" : (classeAtual ?? (situacaoDaNota(nota.itens) === "sugerida" ? (sugestao ?? "") : "")),
  );
  const [observacao, setObservacao] = useState("");

  useEffect(() => {
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [onFechar]);

  const soma = (campo: keyof ItemEntrada) =>
    nota.itens.some((i) => i[campo] !== null)
      ? numeroBR(String(nota.itens.reduce((s, i) => s + Number(i[campo] ?? 0), 0)))
      : "—";
  const lancados = LANCAMENTO[nota.lancamento];
  const semItens = nota.itens.length === 0;

  function salvar() {
    onClassificar(
      nota.itens.map((i) => i.nItem),
      classe ? (classe as ClasseEntrada) : null,
      observacao.trim() || undefined,
    );
    onFechar();
  }

  return (
    <>
      <div className="drawer-overlay open" onClick={onFechar} />
      <aside className="drawer open entradas-ficha" aria-label={`NF ${nota.numero ?? ""}`}>
        <div className="drawer-head">
          <div className="drawer-head-top">
            <div>
              <div className="drawer-co-name">{nota.fornecedor ?? "—"}</div>
              <div className="drawer-co-meta">
                NF {nota.numero ?? "—"} · {nomeEstab(nota.estabelecimento).toUpperCase()} · {dataBR(nota.dataEmissao)}
                {nota.uf ? ` · ${nota.uf}` : ""} · {nota.natureza ?? ""}
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={onFechar} aria-label="Fechar">
              ×
            </button>
          </div>
        </div>
        <div className="drawer-tabs">
          <button
            type="button"
            className={aba === "classificacao" ? "drawer-tab active" : "drawer-tab"}
            onClick={() => setAba("classificacao")}
          >
            Classificação
          </button>
          <button
            type="button"
            className={aba === "itens" ? "drawer-tab active" : "drawer-tab"}
            onClick={() => setAba("itens")}
          >
            Itens <span className="tab-count">{nota.itens.length}</span>
          </button>
          <button
            type="button"
            className={aba === "historico" ? "drawer-tab active" : "drawer-tab"}
            onClick={() => setAba("historico")}
          >
            Histórico
          </button>
        </div>

        <div className="drawer-body">
          <div className="entradas-resumo">
            <div>
              <span className="stat-label">Valor da nota</span>
              <b>{brlOuZero(nota.valor)}</b>
            </div>
            <div>
              <span className="stat-label">ICMS</span>
              <b>{brlOuZero(nota.vIcms)}</b>
            </div>
            <div>
              <span className="stat-label">IPI</span>
              <b>{brlOuZero(nota.vIpi)}</b>
            </div>
            <div>
              <span className="stat-label">Itens</span>
              <b>{nota.itens.length}</b>
            </div>
          </div>

          {aba === "classificacao" && (
            <>
              <p className="entradas-explica">
                <span className={lancados.classe}>{lancados.rotulo}</span> {AJUDA_LANCAMENTO[nota.lancamento]}
              </p>
              {semItens ? (
                <p className="t-sub">
                  O eGestor só tem o resumo desta nota (falta dar ciência). Os itens aparecem quando o arquivo da
                  nota chegar.
                </p>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="entrada-classe">Classificação (todos os itens)</label>
                    <select
                      id="entrada-classe"
                      value={classe}
                      disabled={!podeEditar}
                      onChange={(e) => setClasse(e.target.value)}
                    >
                      <option value="">— escolha —</option>
                      <OpcoesClasse />
                    </select>
                    {classeAtual === "varias" && (
                      <p className="field-hint">
                        Os itens estão com classificações diferentes. Salvar aqui põe a mesma em todos — para
                        classificar item a item, use a aba Itens.
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor="entrada-obs">Observação</label>
                    <textarea
                      id="entrada-obs"
                      rows={3}
                      maxLength={1000}
                      disabled={!podeEditar}
                      placeholder="Opcional — ex.: material de limpeza do escritório; nota de garantia da fonte trocada…"
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {aba === "itens" && (
            <div className="fiscal-tabela entradas-itens">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>NCM</th>
                    <th>CFOP</th>
                    <th style={NUM}>Qtd</th>
                    <th style={NUM}>Valor</th>
                    <th style={NUM}>BC ICMS</th>
                    <th style={NUM}>% ICMS</th>
                    <th style={NUM}>Vlr ICMS</th>
                    <th style={NUM}>% IPI</th>
                    <th style={NUM}>Vlr IPI</th>
                    <th>Classificação</th>
                  </tr>
                </thead>
                <tbody>
                  {nota.itens.map((i) => (
                    <tr key={i.nItem}>
                      <td className="t-mono">{i.nItem}</td>
                      <td className="entradas-item-desc">{i.descricao ?? "—"}</td>
                      <td className="t-mono">{i.ncm ?? "—"}</td>
                      <td className="t-mono">{i.cfop ?? "—"}</td>
                      <td style={NUM}>{qtd(i.quantidade)}</td>
                      <td style={NUM}>{brlOuZero(i.valor)}</td>
                      <td style={NUM}>{valorOuTraco(i.bcIcms)}</td>
                      <td style={NUM}>{pct(i.pIcms)}</td>
                      <td style={NUM}>{valorOuTraco(i.vIcms)}</td>
                      <td style={NUM}>{pct(i.pIpi)}</td>
                      <td style={NUM}>{valorOuTraco(i.vIpi)}</td>
                      <td>
                        <div className="entradas-classe">
                          <select
                            className={i.classe ? "" : i.sugestao ? "sugerida" : "vazia"}
                            value={i.classe ?? i.sugestao ?? ""}
                            disabled={!podeEditar}
                            onChange={(e) =>
                              onClassificar([i.nItem], e.target.value ? (e.target.value as ClasseEntrada) : null)
                            }
                            aria-label={`Classificação do item ${i.nItem}`}
                          >
                            <option value="">— classificar —</option>
                            <OpcoesClasse />
                          </select>
                          {!i.classe && i.sugestao && podeEditar && (
                            <button
                              type="button"
                              className="entradas-confirmar"
                              onClick={() => onClassificar([i.nItem], i.sugestao)}
                            >
                              Confirmar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {nota.itens.length > 0 && (
                  <tfoot>
                    <tr>
                      <td />
                      <td colSpan={4}>Total dos itens</td>
                      <td style={NUM}>{brlOuZero(String(nota.itens.reduce((s, i) => s + Number(i.valor ?? 0), 0)))}</td>
                      <td style={NUM}>{soma("bcIcms")}</td>
                      <td />
                      <td style={NUM}>{soma("vIcms")}</td>
                      <td />
                      <td style={NUM}>{soma("vIpi")}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {aba === "historico" && (
            <div className="entradas-historico">
              {historico.length === 0 ? (
                <p className="t-sub">Nenhuma classificação registrada nesta nota ainda.</p>
              ) : (
                <ul>
                  {[...historico].reverse().map((h, k) => (
                    <li key={`${h.criadoEm}-${h.nItem}-${k}`}>
                      <span className="t-sub">{formatDateTimeBR(h.criadoEm)}</span> · <strong>{h.autor}</strong> —
                      item {h.nItem}: {h.classe ? rotuloClasse(h.classe) : "classificação retirada"}
                      {h.observacao ? ` — ${h.observacao}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {aba === "classificacao" && podeEditar && !semItens && (
          <div className="entradas-ficha-pe">
            <button type="button" className="btn" onClick={onFechar}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={salvar}>
              Salvar classificação
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
