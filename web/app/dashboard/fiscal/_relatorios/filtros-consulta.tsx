"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { GRUPOS_CLASSE, rotuloClasse } from "./classes-entrada";
import { dataBR, PAGINA } from "./formato";
import {
  ATALHOS,
  CHAVES_EXTRAS,
  chaveMes,
  faixaConsulta,
  INICIO_DA_BASE,
  MESES_CURTO,
  MESES_NOME,
} from "./periodo-consulta";
import type { ClasseEntrada } from "@/lib/api/fiscal";

// Filtros da aba Consultar notas (pedido do usuário, 2026-10-28): na barra
// só período, empresa, número e item; o resto mora na janela "Mais
// filtros", aberta pelo ícone ao lado. O que está ligado na janela fica à
// vista embaixo da barra, cada um com um "×" que tira só ele — mesmo molde
// do filtro da Prospecção. Pesquisar troca a querystring da página; a
// consulta roda no servidor.

type Extras = Partial<Record<(typeof CHAVES_EXTRAS)[number], string>>;

const SITUACOES = [
  { valor: "autorizada", rotulo: "Autorizada" },
  { valor: "cancelada", rotulo: "Cancelada" },
  { valor: "denegada", rotulo: "Denegada" },
  { valor: "inutilizada", rotulo: "Inutilizada" },
  { valor: "resumo", rotulo: "Só resumo (sem ciência)" },
];

const MARCAS = [
  { valor: "receita", rotulo: "Receita" },
  { valor: "remessa", rotulo: "Remessa" },
  { valor: "exige-retorno", rotulo: "Exige retorno" },
  { valor: "retorno", rotulo: "Retorno" },
  { valor: "transferencia", rotulo: "Transferência" },
  { valor: "importacao", rotulo: "Importação" },
  { valor: "dev-venda", rotulo: "Devolução de venda" },
  { valor: "dev-compra", rotulo: "Devolução de compra" },
  { valor: "sem-cadastro", rotulo: "CFOP sem cadastro" },
];

const IMPOSTOS = [
  { valor: "icms", rotulo: "ICMS" },
  { valor: "st", rotulo: "ICMS-ST" },
  { valor: "ipi", rotulo: "IPI" },
  { valor: "difal", rotulo: "DIFAL" },
  { valor: "iss", rotulo: "ISS" },
  { valor: "retencao", rotulo: "Retenções (NFS-e)" },
];

const UFS =
  "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");

const lista = (v?: string) => (v ? v.split(",").filter(Boolean) : []);
const rotuloDe = (opcoes: { valor: string; rotulo: string }[], v: string) =>
  opcoes.find((o) => o.valor === v)?.rotulo ?? v;

// Valor digitado do jeito brasileiro ("1.234,50") → "1234.50" pra API.
function valorApi(texto: string): string {
  const limpo = texto.trim().replace(/\s|R\$/g, "");
  if (!limpo) return "";
  const n = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  return /^\d{1,13}(\.\d{1,2})?$/.test(n) ? n : "";
}
function valorTela(api?: string): string {
  if (!api) return "";
  const n = Number(api);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}
const moeda = (api: string) =>
  Number(api).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Uma etiqueta por filtro ligado na janela (a que aparece embaixo da barra).
function etiquetas(x: Extras): { chave: keyof Extras; texto: string }[] {
  const r: { chave: keyof Extras; texto: string }[] = [];
  const add = (chave: keyof Extras, texto: string) => r.push({ chave, texto });
  if (x.doc) add("doc", x.doc === "nfe" ? "Só NF-e" : "Só NFS-e");
  if (x.situacao) add("situacao", rotuloDe(SITUACOES, x.situacao));
  if (x.serie) add("serie", `Série ${x.serie}`);
  if (x.chave) add("chave", `Chave ${x.chave.length > 12 ? x.chave.slice(0, 12) + "…" : x.chave}`);
  if (x.sentido) add("sentido", x.sentido === "entrada" ? "Só entrada" : "Só saída");
  if (x.emitente) add("emitente", x.emitente === "gama" ? "Emitida pela Gama" : "Recebida de terceiro");
  if (x.estabelecimento) add("estabelecimento", x.estabelecimento === "matriz" ? "Só Matriz" : "Só Filial");
  if (x.transferencia) add("transferencia", x.transferencia === "so" ? "Só transferências" : "Sem transferências");
  if (x.uf) add("uf", `UF ${x.uf}`);
  if (x.ncm) add("ncm", `NCM ${x.ncm}`);
  if (x.servico) add("servico", `Serviço ${x.servico}`);
  if (x.classe)
    add("classe", x.classe === "sem" ? "Sem classificação" : `Classificação: ${rotuloClasse(x.classe as ClasseEntrada)}`);
  if (x.cfop) add("cfop", `CFOP ${lista(x.cfop).join(", ")}`);
  if (x.marcas) add("marcas", lista(x.marcas).map((m) => rotuloDe(MARCAS, m)).join(" ou "));
  if (x.impostos) add("impostos", `Com ${lista(x.impostos).map((m) => rotuloDe(IMPOSTOS, m)).join(" e ")}`);
  if (x.vNotaMin) add("vNotaMin", `Nota a partir de ${moeda(x.vNotaMin)}`);
  if (x.vNotaMax) add("vNotaMax", `Nota até ${moeda(x.vNotaMax)}`);
  if (x.vItemMin) add("vItemMin", `Item a partir de ${moeda(x.vItemMin)}`);
  if (x.vItemMax) add("vItemMax", `Item até ${moeda(x.vItemMax)}`);
  return r;
}

export default function FiltrosConsulta({ inicial }: { inicial: Record<string, string> }) {
  const router = useRouter();
  const [pesquisando, startTransition] = useTransition();

  const faixaInicial = faixaConsulta(inicial.periodo, inicial.inicio, inicial.fim);
  const [periodo, setPeriodo] = useState(faixaInicial.periodo);
  const [inicio, setInicio] = useState(faixaInicial.inicio);
  const [fim, setFim] = useState(faixaInicial.fim);
  const [empresa, setEmpresa] = useState(inicial.empresa ?? "");
  const [numero, setNumero] = useState(inicial.numero ?? "");
  const [item, setItem] = useState(inicial.item ?? "");
  const [extras, setExtras] = useState<Extras>(() => {
    const x: Extras = {};
    for (const k of CHAVES_EXTRAS) if (inicial[k]) x[k] = inicial[k];
    return x;
  });
  const [janela, setJanela] = useState(false);

  // A URL é a fonte da verdade: voltar/avançar no navegador realinha a barra.
  useEffect(() => {
    const f = faixaConsulta(inicial.periodo, inicial.inicio, inicial.fim);
    setPeriodo(f.periodo);
    setInicio(f.inicio);
    setFim(f.fim);
    setEmpresa(inicial.empresa ?? "");
    setNumero(inicial.numero ?? "");
    setItem(inicial.item ?? "");
    const x: Extras = {};
    for (const k of CHAVES_EXTRAS) if (inicial[k]) x[k] = inicial[k];
    setExtras(x);
  }, [inicial]);

  function pesquisar(novosExtras: Extras = extras) {
    const q = new URLSearchParams({ r: "consulta", periodo });
    if (periodo === "personalizado") {
      q.set("inicio", inicio);
      q.set("fim", fim);
    }
    if (empresa.trim()) q.set("empresa", empresa.trim());
    if (numero.trim()) q.set("numero", numero.replace(/\D/g, ""));
    if (item.trim()) q.set("item", item.trim());
    for (const k of CHAVES_EXTRAS) if (novosExtras[k]) q.set(k, novosExtras[k]!);
    if (inicial.ver && inicial.ver !== "nota") q.set("ver", inicial.ver);
    startTransition(() => router.push(`${PAGINA}?${q.toString()}`));
  }

  const ligados = etiquetas(extras);

  return (
    <div className="panel consulta-filtros">
      <form
        className="consulta-barra"
        onSubmit={(e) => {
          e.preventDefault();
          pesquisar();
        }}
        aria-label="Filtros da consulta"
      >
        <div className="field consulta-periodo">
          <label htmlFor="consulta-periodo-btn">Período</label>
          <Periodo
            periodo={periodo}
            inicio={inicio}
            fim={fim}
            onMudar={(p, i, f) => {
              setPeriodo(p);
              setInicio(i);
              setFim(f);
            }}
          />
        </div>
        <div className="field consulta-empresa">
          <label htmlFor="consulta-empresa">Empresa</label>
          <input
            id="consulta-empresa"
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            placeholder="Nome, razão social ou CNPJ"
            maxLength={200}
          />
        </div>
        <div className="field consulta-numero">
          <label htmlFor="consulta-numero">Número</label>
          <input
            id="consulta-numero"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            inputMode="numeric"
            placeholder="ex. 1532"
            maxLength={12}
          />
        </div>
        <div className="field consulta-item">
          <label htmlFor="consulta-item">Item</label>
          <input
            id="consulta-item"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="Descrição ou código do produto/serviço"
            maxLength={200}
          />
        </div>
        <div className="consulta-acoes">
          <button
            type="button"
            className={ligados.length ? "btn filtro-btn ativo consulta-mais" : "btn filtro-btn consulta-mais"}
            onClick={() => setJanela(true)}
            title="Mais filtros"
            aria-label={ligados.length ? `Mais filtros (${ligados.length} ligados)` : "Mais filtros"}
          >
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            </svg>
            {ligados.length > 0 && <span className="consulta-conta">{ligados.length}</span>}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pesquisando}>
            {pesquisando ? "Pesquisando…" : "Pesquisar"}
          </button>
        </div>
      </form>

      {ligados.length > 0 && (
        <div className="consulta-ligados">
          {ligados.map((l) => (
            <span key={l.chave} className="tag-chip">
              {l.texto}
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`Tirar filtro ${l.texto}`}
                onClick={() => {
                  const novo = { ...extras };
                  delete novo[l.chave];
                  setExtras(novo);
                  pesquisar(novo);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setExtras({});
              pesquisar({});
            }}
          >
            Limpar todos
          </button>
        </div>
      )}

      {janela && (
        <MaisFiltros
          valor={extras}
          onFechar={() => setJanela(false)}
          onAplicar={(novo) => {
            setExtras(novo);
            setJanela(false);
            pesquisar(novo);
          }}
        />
      )}
    </div>
  );
}

// ---------- Período: um campo só, com atalhos, mês e datas ----------

function Periodo({
  periodo,
  inicio,
  fim,
  onMudar,
}: {
  periodo: string;
  inicio: string;
  fim: string;
  onMudar: (periodo: string, inicio: string, fim: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const mesEscolhido = /^\d{4}-\d{2}$/.test(periodo);
  const [lado, setLado] = useState<"datas" | "meses">(mesEscolhido ? "meses" : "datas");
  const hoje = faixaConsulta("mes");
  const anoHoje = Number(hoje.inicio.slice(0, 4));
  const mesHoje = Number(hoje.inicio.slice(5, 7)) - 1;
  const anoBase = Number(INICIO_DA_BASE.slice(0, 4));
  const mesBase = Number(INICIO_DA_BASE.slice(5, 7)) - 1;
  const [anoVisto, setAnoVisto] = useState(mesEscolhido ? Number(periodo.slice(0, 4)) : anoHoje);
  const [ini, setIni] = useState(inicio);
  const [fi, setFi] = useState(fim);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    setIni(inicio);
    setFi(fim);
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAberto(false);
        botao.current?.focus();
      }
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto, inicio, fim]);

  function escolher(p: string, i?: string, f?: string) {
    const faixa = faixaConsulta(p, i, f);
    onMudar(faixa.periodo, faixa.inicio, faixa.fim);
    setAberto(false);
    botao.current?.focus();
  }

  const rotulo = faixaConsulta(periodo, inicio, fim).rotulo;

  return (
    <div className="consulta-periodo-caixa" ref={caixa}>
      <button
        type="button"
        id="consulta-periodo-btn"
        ref={botao}
        className="consulta-periodo-btn"
        aria-haspopup="true"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="consulta-periodo-txt">
          <span className="t-sub">{rotulo}</span> · {dataBR(inicio)} a {dataBR(fim)}
        </span>
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {aberto && (
        <div className="consulta-pop">
          <div className="consulta-pop-atalhos" role="group" aria-label="Atalhos de período">
            {ATALHOS.map((a) => {
              const ativo = a.valor === "mes-x" ? lado === "meses" : periodo === a.valor && lado === "datas";
              return (
                <button
                  key={a.valor}
                  type="button"
                  className={ativo ? "ativo" : undefined}
                  aria-pressed={ativo}
                  onClick={() => {
                    if (a.valor === "mes-x") setLado("meses");
                    else {
                      setLado("datas");
                      escolher(a.valor);
                    }
                  }}
                >
                  {a.label}
                  {a.valor === "mes-x" && " ›"}
                </button>
              );
            })}
          </div>

          {lado === "meses" ? (
            <div className="consulta-pop-meses">
              <div className="consulta-ano">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={anoVisto <= anoBase}
                  onClick={() => setAnoVisto((a) => a - 1)}
                  aria-label="Ano anterior"
                >
                  ‹
                </button>
                <span>{anoVisto}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={anoVisto >= anoHoje}
                  onClick={() => setAnoVisto((a) => a + 1)}
                  aria-label="Próximo ano"
                >
                  ›
                </button>
              </div>
              <div className="consulta-meses" role="group" aria-label={`Meses de ${anoVisto}`}>
                {MESES_CURTO.map((m, i) => {
                  const chave = chaveMes(anoVisto, i);
                  const fora = (anoVisto === anoBase && i < mesBase) || (anoVisto === anoHoje && i > mesHoje);
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={fora}
                      className={periodo === chave ? "ativo" : undefined}
                      aria-pressed={periodo === chave}
                      aria-label={`${MESES_NOME[i]} de ${anoVisto}`}
                      onClick={() => escolher(chave)}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="consulta-pop-datas">
              <div className="field">
                <label htmlFor="consulta-de">De</label>
                <input id="consulta-de" type="date" value={ini} onChange={(e) => setIni(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="consulta-ate">Até</label>
                <input id="consulta-ate" type="date" value={fi} onChange={(e) => setFi(e.target.value)} />
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!ini || !fi}
                onClick={() => escolher("personalizado", ini, fi)}
              >
                Usar estas datas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Janela "Mais filtros" ----------

function Seg({
  opcoes,
  valor,
  onMudar,
  rotulo,
}: {
  opcoes: { valor: string; rotulo: string }[];
  valor: string;
  onMudar: (v: string) => void;
  rotulo: string;
}) {
  return (
    <div className="seg consulta-seg" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          className={valor === o.valor ? "active" : undefined}
          aria-pressed={valor === o.valor}
          onClick={() => onMudar(o.valor)}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

function MaisFiltros({
  valor,
  onAplicar,
  onFechar,
}: {
  valor: Extras;
  onAplicar: (x: Extras) => void;
  onFechar: () => void;
}) {
  // Rascunho: só vale ao clicar Aplicar; Cancelar/fechar descarta.
  const [r, setR] = useState<Extras>(() => ({
    ...valor,
    vNotaMin: valorTela(valor.vNotaMin),
    vNotaMax: valorTela(valor.vNotaMax),
    vItemMin: valorTela(valor.vItemMin),
    vItemMax: valorTela(valor.vItemMax),
  }));
  const [cfopDigitado, setCfopDigitado] = useState("");
  const set = (k: keyof Extras, v: string) => setR((a) => ({ ...a, [k]: v }));
  const alternar = (k: "marcas" | "impostos", v: string) =>
    setR((a) => {
      const atual = lista(a[k]);
      return { ...a, [k]: (atual.includes(v) ? atual.filter((x) => x !== v) : [...atual, v]).join(",") };
    });

  useEffect(() => {
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onFechar]);

  function addCfop() {
    const v = cfopDigitado.replace(/[^0-9xX]/g, "").toLowerCase();
    setCfopDigitado("");
    const atual = lista(r.cfop);
    if (/^[1-7][0-9x]{3}$/.test(v) && !atual.includes(v) && atual.length < 30) set("cfop", [...atual, v].join(","));
  }

  function aplicar() {
    const limpo: Extras = {};
    for (const k of CHAVES_EXTRAS) {
      let v = (r[k] ?? "").trim();
      if (k.startsWith("v")) v = valorApi(v);
      if (k === "serie" || k === "chave" || k === "ncm") v = v.replace(/\D/g, "");
      if (v) limpo[k] = v;
    }
    onAplicar(limpo);
  }

  return (
    <div className="overlay open" onClick={onFechar}>
      <div
        className="modal wide consulta-janela"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consulta-janela-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title" id="consulta-janela-titulo">
            Mais filtros
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <fieldset className="consulta-secao">
            <legend>Documento</legend>
            <div className="consulta-grade">
              <div className="field">
                <span className="consulta-rotulo">Tipo</span>
                <Seg
                  rotulo="Tipo de documento"
                  valor={r.doc ?? ""}
                  onMudar={(v) => set("doc", v)}
                  opcoes={[
                    { valor: "", rotulo: "Todos" },
                    { valor: "nfe", rotulo: "NF-e" },
                    { valor: "nfse", rotulo: "NFS-e" },
                  ]}
                />
              </div>
              <div className="field">
                <label htmlFor="cf-situacao">Situação</label>
                <select id="cf-situacao" value={r.situacao ?? ""} onChange={(e) => set("situacao", e.target.value)}>
                  <option value="">Todas</option>
                  {SITUACOES.map((s) => (
                    <option key={s.valor} value={s.valor}>
                      {s.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cf-serie">Série</label>
                <input
                  id="cf-serie"
                  inputMode="numeric"
                  maxLength={5}
                  value={r.serie ?? ""}
                  onChange={(e) => set("serie", e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="cf-chave">Chave de acesso</label>
              <input
                id="cf-chave"
                inputMode="numeric"
                maxLength={60}
                placeholder="44 dígitos, ou o começo dela"
                value={r.chave ?? ""}
                onChange={(e) => set("chave", e.target.value)}
              />
            </div>
          </fieldset>

          <fieldset className="consulta-secao">
            <legend>Entrada e saída</legend>
            <div className="consulta-grade">
              <div className="field">
                <span className="consulta-rotulo">Origem</span>
                <Seg
                  rotulo="Origem"
                  valor={r.sentido ?? ""}
                  onMudar={(v) => set("sentido", v)}
                  opcoes={[
                    { valor: "", rotulo: "Ambas" },
                    { valor: "entrada", rotulo: "Entrada" },
                    { valor: "saida", rotulo: "Saída" },
                  ]}
                />
              </div>
              <div className="field">
                <span className="consulta-rotulo">Quem emitiu</span>
                <Seg
                  rotulo="Quem emitiu"
                  valor={r.emitente ?? ""}
                  onMudar={(v) => set("emitente", v)}
                  opcoes={[
                    { valor: "", rotulo: "Todas" },
                    { valor: "gama", rotulo: "Gama" },
                    { valor: "terceiro", rotulo: "Terceiro" },
                  ]}
                />
              </div>
              <div className="field">
                <span className="consulta-rotulo">Estabelecimento</span>
                <Seg
                  rotulo="Estabelecimento"
                  valor={r.estabelecimento ?? ""}
                  onMudar={(v) => set("estabelecimento", v)}
                  opcoes={[
                    { valor: "", rotulo: "Ambos" },
                    { valor: "matriz", rotulo: "Matriz" },
                    { valor: "filial", rotulo: "Filial" },
                  ]}
                />
              </div>
              <div className="field">
                <label htmlFor="cf-transf">Transferência Matriz ⇄ Filial</label>
                <select
                  id="cf-transf"
                  value={r.transferencia ?? ""}
                  onChange={(e) => set("transferencia", e.target.value)}
                >
                  <option value="">Incluir</option>
                  <option value="excluir">Deixar de fora</option>
                  <option value="so">Só transferências</option>
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset className="consulta-secao">
            <legend>Empresa e produto</legend>
            <div className="consulta-grade">
              <div className="field">
                <label htmlFor="cf-uf">UF da empresa</label>
                <select id="cf-uf" value={r.uf ?? ""} onChange={(e) => set("uf", e.target.value)}>
                  <option value="">Todas</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cf-ncm">NCM</label>
                <input
                  id="cf-ncm"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="8414 ou 84148019"
                  value={r.ncm ?? ""}
                  onChange={(e) => set("ncm", e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="cf-servico">Código de serviço</label>
                <input
                  id="cf-servico"
                  maxLength={10}
                  placeholder="ex. 14.01"
                  value={r.servico ?? ""}
                  onChange={(e) => set("servico", e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="cf-classe">Classificação da entrada</label>
                <select id="cf-classe" value={r.classe ?? ""} onChange={(e) => set("classe", e.target.value)}>
                  <option value="">Qualquer</option>
                  <option value="sem">Sem classificação</option>
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
            </div>
          </fieldset>

          <fieldset className="consulta-secao">
            <legend>CFOP</legend>
            <div className="field">
              <label htmlFor="cf-cfop">Códigos</label>
              <div className="consulta-chips">
                {lista(r.cfop).map((c) => (
                  <span key={c} className="tag-chip">
                    {c}
                    <button
                      type="button"
                      className="tag-chip-remove"
                      aria-label={`Tirar CFOP ${c}`}
                      onClick={() => set("cfop", lista(r.cfop).filter((x) => x !== c).join(","))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  id="cf-cfop"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="digite e Enter: 5102, 59xx"
                  value={cfopDigitado}
                  onChange={(e) => setCfopDigitado(e.target.value)}
                  onBlur={addCfop}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addCfop();
                    } else if (e.key === "Backspace" && !cfopDigitado && r.cfop) {
                      set("cfop", lista(r.cfop).slice(0, -1).join(","));
                    }
                  }}
                />
              </div>
              <div className="field-hint">
                “59xx” pega a faixa toda. Na nota recebida o CFOP é o do fornecedor, como está no XML.
              </div>
            </div>
            <div className="field">
              <span className="consulta-rotulo">Marcação na tabela de CFOP</span>
              <div className="consulta-marcas">
                {MARCAS.map((m) => {
                  const on = lista(r.marcas).includes(m.valor);
                  return (
                    <button
                      key={m.valor}
                      type="button"
                      className={on ? "consulta-marca ativo" : "consulta-marca"}
                      aria-pressed={on}
                      onClick={() => alternar("marcas", m.valor)}
                    >
                      {m.rotulo}
                    </button>
                  );
                })}
              </div>
            </div>
          </fieldset>

          <fieldset className="consulta-secao">
            <legend>Valores e impostos</legend>
            <div className="consulta-grade">
              <div className="field">
                <span className="consulta-rotulo">Valor da nota (R$)</span>
                <div className="consulta-par">
                  <input
                    aria-label="Valor da nota a partir de"
                    inputMode="decimal"
                    placeholder="de"
                    value={r.vNotaMin ?? ""}
                    onChange={(e) => set("vNotaMin", e.target.value)}
                  />
                  <span>a</span>
                  <input
                    aria-label="Valor da nota até"
                    inputMode="decimal"
                    placeholder="até"
                    value={r.vNotaMax ?? ""}
                    onChange={(e) => set("vNotaMax", e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <span className="consulta-rotulo">Valor do item (R$)</span>
                <div className="consulta-par">
                  <input
                    aria-label="Valor do item a partir de"
                    inputMode="decimal"
                    placeholder="de"
                    value={r.vItemMin ?? ""}
                    onChange={(e) => set("vItemMin", e.target.value)}
                  />
                  <span>a</span>
                  <input
                    aria-label="Valor do item até"
                    inputMode="decimal"
                    placeholder="até"
                    value={r.vItemMax ?? ""}
                    onChange={(e) => set("vItemMax", e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="field">
              <span className="consulta-rotulo">Com imposto destacado</span>
              <div className="consulta-checks">
                {IMPOSTOS.map((i) => (
                  <label key={i.valor} className="consulta-check">
                    <input
                      type="checkbox"
                      checked={lista(r.impostos).includes(i.valor)}
                      onChange={() => alternar("impostos", i.valor)}
                    />
                    <span>{i.rotulo}</span>
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
        </div>
        <div className="modal-foot consulta-janela-pe">
          <button type="button" className="btn btn-ghost" onClick={() => setR({})}>
            Limpar estes filtros
          </button>
          <div className="consulta-janela-acoes">
            <button type="button" className="btn" onClick={onFechar}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={aplicar}>
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
