"use client";

import { Fragment, useMemo, useOptimistic, useState, useTransition, type DragEvent } from "react";
import type {
  LinhaRemessa,
  RegistroAlerta,
  RetornoDaRemessa,
  RetornoDisponivel,
  SituacaoRetorno,
} from "@/lib/api/fiscal";
import { desvincularRetornoAction, reabrirAlertaAction, tratarAlertaAction, vincularRetornoAction } from "../actions";
import AlertasDaRemessa from "./alertas-da-remessa";
import { passaFiltroAlerta, REGRAS_ALERTA, situacoesAlertas, textoAlertas } from "./alertas-remessa";
import { dataBR, nomeEstab, numeroBR, operacaoCurta, semAcento, SITUACAO_RETORNO } from "./formato";

// Controle de remessas no formato da planilha do usuário (decisão 7.5):
// remessas à esquerda, com o bloco do retorno em branco até ter vínculo,
// e as notas de retorno à direita pra arrastar até a linha. O vínculo que
// a própria nota faz (cita a remessa no XML) já vem preenchido; o × desfaz
// qualquer um. A tela muda na hora e o servidor confirma em seguida — se
// recusar, a mensagem aparece em cima e a linha volta.

type Estado = { rows: LinhaRemessa[]; retornos: RetornoDisponivel[] };
type Acao =
  | { tipo: "vincular"; remessaChave: string; retorno: RetornoDisponivel }
  | { tipo: "desvincular"; remessaChave: string; retornoChave: string };

const TIPO_NF = { enviada: "Saída", recebida: "Entrada" } as const;

// Itens da remessa que aparecem na linha; o resto fica no "+ N" e na dica
// do mouse. No retorno vai um só por linha, pra cada retorno ocupar uma
// linha e ficar alinhado com a data, a NF e o valor dele.
const ITENS_VISIVEIS = 2;

function resumoItens(itens: string[]): string {
  if (itens.length === 0) return "—";
  return itens.length === 1 ? itens[0] : `${itens[0]} (+ ${itens.length - 1})`;
}

export default function PainelRemessas({
  rows,
  retornos,
  alertasLog,
  podeEditar,
  linkImpressao,
}: {
  rows: LinhaRemessa[];
  retornos: RetornoDisponivel[];
  alertasLog: RegistroAlerta[];
  podeEditar: boolean;
  linkImpressao: string;
}) {
  const [estado, aplicar] = useOptimistic<Estado, Acao>({ rows, retornos }, reduzir);
  const [log, acrescentarLog] = useOptimistic<RegistroAlerta[], RegistroAlerta>(alertasLog, (atual, novo) => [
    ...atual,
    novo,
  ]);
  // Remessa com o detalhe dos alertas aberto (clique no sinal da linha).
  const [aberta, setAberta] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<RetornoDisponivel | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [mostrarVinculados, setMostrarVinculados] = useState(false);
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroItem, setFiltroItem] = useState("");
  // Valores em passaFiltroAlerta (alertas-remessa.ts).
  const [filtroAlerta, setFiltroAlerta] = useState("");

  // Alertas de cada linha pelo acervo de regras (decisão 7.6), separados
  // em pendentes e tratados pelo último registro do log (decisão 7.7).
  // Tratado sai do radar: não conta no card nem pinta a linha de vermelho.
  const situacoes = useMemo(() => situacoesAlertas(estado.rows, log), [estado.rows, log]);
  const alertas = useMemo(
    () => new Map([...situacoes].map(([chave, s]) => [chave, s.pendentes] as const)),
    [situacoes],
  );

  function registrarAlerta(remessaChave: string, regra: string, acao: RegistroAlerta["acao"], observacao: string) {
    setErro(null);
    startTransition(async () => {
      acrescentarLog({
        remessaChave,
        regra,
        acao,
        observacao: observacao || null,
        autor: "Você",
        criadoEm: new Date().toISOString(),
      });
      const chamada = acao === "tratar" ? tratarAlertaAction : reabrirAlertaAction;
      const r = await chamada({ remessaChave, regra, observacao: observacao || undefined });
      if (r.erro) setErro(r.erro);
    });
  }

  // Filtros da tabela de remessas (pedido do usuário, 2026-10-26): empresa
  // e item, na hora, sobre as linhas já carregadas — parte do nome basta,
  // sem diferença de maiúscula nem de acento. As sugestões vêm das próprias
  // remessas da tela. O de alerta vem do card de alertas.
  const linhas = useMemo(() => {
    const empresa = semAcento(filtroEmpresa.trim());
    const item = semAcento(filtroItem.trim());
    if (!empresa && !item && !filtroAlerta) return estado.rows;
    return estado.rows.filter(
      (r) =>
        (!empresa || semAcento(r.contraparte ?? "").includes(empresa)) &&
        (!item || r.itens.some((i) => semAcento(i).includes(item))) &&
        passaFiltroAlerta(filtroAlerta, situacoes.get(r.chave)),
    );
  }, [estado.rows, situacoes, filtroEmpresa, filtroItem, filtroAlerta]);

  const contagemAlertas = useMemo(() => {
    const porRegra = REGRAS_ALERTA.map((regra) => ({
      regra,
      linhas: estado.rows.filter((r) => alertas.get(r.chave)?.some((a) => a.codigo === regra.codigo)).length,
    }));
    const comAlerta = estado.rows.filter((r) => (alertas.get(r.chave)?.length ?? 0) > 0).length;
    const comTratado = estado.rows.filter((r) => (situacoes.get(r.chave)?.tratados.length ?? 0) > 0).length;
    return { porRegra, comAlerta, comTratado };
  }, [estado.rows, alertas, situacoes]);

  const sugestoes = useMemo(
    () => ({
      empresas: [...new Set(estado.rows.map((r) => r.contraparte).filter((c): c is string => !!c))].sort(),
      itens: [...new Set(estado.rows.flatMap((r) => r.itens))].sort(),
    }),
    [estado.rows],
  );

  const listaRetornos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return estado.retornos.filter(
      (r) =>
        (mostrarVinculados || r.vinculos === 0) &&
        (!termo || (r.contraparte ?? "").toLowerCase().includes(termo) || String(r.numero ?? "").includes(termo)),
    );
  }, [estado.retornos, busca, mostrarVinculados]);

  function soltar(remessa: LinhaRemessa, chaveRetorno: string) {
    setAlvo(null);
    setArrastando(null);
    const retorno = estado.retornos.find((r) => r.chave === chaveRetorno);
    if (!retorno || remessa.retornos.some((x) => x.chave === chaveRetorno)) return;
    if (retorno.fecha !== remessa.lado) {
      setErro(
        remessa.lado === "enviada"
          ? "Essa nota devolve remessa que a Gama recebeu — não fecha remessa de saída."
          : "Essa nota registra a volta de remessa que a Gama enviou — não fecha remessa de entrada.",
      );
      return;
    }
    setErro(null);
    startTransition(async () => {
      aplicar({ tipo: "vincular", remessaChave: remessa.chave, retorno });
      const r = await vincularRetornoAction({ remessaChave: remessa.chave, retornoChave: chaveRetorno });
      if (r.erro) setErro(r.erro);
    });
  }

  function desfazer(remessa: LinhaRemessa, retorno: RetornoDaRemessa) {
    setErro(null);
    startTransition(async () => {
      aplicar({ tipo: "desvincular", remessaChave: remessa.chave, retornoChave: retorno.chave });
      const r = await desvincularRetornoAction({ remessaChave: remessa.chave, retornoChave: retorno.chave });
      if (r.erro) setErro(r.erro);
    });
  }

  const sobre = (remessa: LinhaRemessa) => ({
    onDragOver: (e: DragEvent) => {
      if (!arrastando || arrastando.fecha !== remessa.lado) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "link";
      if (alvo !== remessa.chave) setAlvo(remessa.chave);
    },
    onDragLeave: () => {
      if (alvo === remessa.chave) setAlvo(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      soltar(remessa, e.dataTransfer.getData("text/plain"));
    },
  });

  function classeLinha(remessa: LinhaRemessa): string | undefined {
    if (!arrastando) return undefined;
    if (arrastando.fecha !== remessa.lado) return "alvo-impossivel";
    return alvo === remessa.chave ? "alvo-ativo" : "alvo-possivel";
  }

  return (
    <>
      {erro && (
        <div className="error-banner" role="alert">
          {erro}{" "}
          <button type="button" className="vinculo-desfazer" onClick={() => setErro(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      <div className="panel alertas-card">
        <div className="alertas-titulo">
          <span className="alerta-sinal" aria-hidden="true">
            !
          </span>
          <strong>Alertas</strong>
          <span className="t-sub">
            {contagemAlertas.comAlerta === 0
              ? "nenhuma remessa com alerta pendente"
              : `${contagemAlertas.comAlerta} remessa(s) com alerta pendente · clique para filtrar; clique no sinal da linha para tratar`}
          </span>
        </div>
        <div className="alertas-filtros" role="group" aria-label="Filtrar por alerta">
          <button
            type="button"
            className={filtroAlerta === "qualquer" ? "alerta-filtro ativo" : "alerta-filtro"}
            onClick={() => setFiltroAlerta(filtroAlerta === "qualquer" ? "" : "qualquer")}
            disabled={contagemAlertas.comAlerta === 0}
          >
            Todos os alertas <span className="qtd">{contagemAlertas.comAlerta}</span>
          </button>
          {contagemAlertas.porRegra.map(({ regra, linhas: qtd }) => (
            <button
              key={regra.codigo}
              type="button"
              title={regra.ajuda}
              className={filtroAlerta === regra.codigo ? "alerta-filtro ativo" : "alerta-filtro"}
              onClick={() => setFiltroAlerta(filtroAlerta === regra.codigo ? "" : regra.codigo)}
              disabled={qtd === 0}
            >
              {regra.rotulo} <span className="qtd">{qtd}</span>
            </button>
          ))}
          <button
            type="button"
            title="Remessas com alerta já marcado como tratado"
            className={filtroAlerta === "tratados" ? "alerta-filtro tratados ativo" : "alerta-filtro tratados"}
            onClick={() => setFiltroAlerta(filtroAlerta === "tratados" ? "" : "tratados")}
            disabled={contagemAlertas.comTratado === 0}
          >
            ✓ Tratados <span className="qtd">{contagemAlertas.comTratado}</span>
          </button>
        </div>
      </div>

      <div className={podeEditar ? "remessas-painel" : "remessas-painel so-leitura"}>
        <div className="panel rel-resultado">
          <div className="panel-head">
            <div>
              <div className="panel-title">Remessas</div>
              <div className="sub">
                {linhas.length === estado.rows.length
                  ? `${estado.rows.length} remessa(s)`
                  : `${linhas.length} de ${estado.rows.length} remessa(s)`}
                {podeEditar ? " · arraste a nota de retorno da direita para a linha da remessa" : ""}
              </div>
            </div>
            <a
              className="btn"
              href={[
                linkImpressao,
                filtroEmpresa.trim() && `empresa=${encodeURIComponent(filtroEmpresa.trim())}`,
                filtroItem.trim() && `item=${encodeURIComponent(filtroItem.trim())}`,
                filtroAlerta && `alerta=${encodeURIComponent(filtroAlerta)}`,
              ]
                .filter(Boolean)
                .join("&")}
              target="_blank"
              rel="noopener"
              title="Abre o relatório com os filtros da tela, pronto para imprimir ou salvar em PDF"
            >
              Imprimir / PDF
            </a>
          </div>
          <div className="remessas-filtro">
            <div className="field">
              <label htmlFor="filtro-empresa">Empresa</label>
              <input
                id="filtro-empresa"
                type="search"
                list="remessas-empresas"
                placeholder="Nome da empresa"
                value={filtroEmpresa}
                onChange={(e) => setFiltroEmpresa(e.target.value)}
              />
              <datalist id="remessas-empresas">
                {sugestoes.empresas.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="filtro-item">Item</label>
              <input
                id="filtro-item"
                type="search"
                list="remessas-itens"
                placeholder="Descrição do item"
                value={filtroItem}
                onChange={(e) => setFiltroItem(e.target.value)}
              />
              <datalist id="remessas-itens">
                {sugestoes.itens.map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
            </div>
            {(filtroEmpresa || filtroItem || filtroAlerta) && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFiltroEmpresa("");
                  setFiltroItem("");
                  setFiltroAlerta("");
                }}
              >
                Limpar
              </button>
            )}
          </div>
          <div className="panel-body">
            <div className="fiscal-tabela remessas-rolagem">
              <table className="data-table remessas-tabela">
                <thead>
                  <tr className="grupo">
                    <th colSpan={9}>Remessa</th>
                    <th colSpan={6} className="inicio-retorno">
                      Retorno
                    </th>
                  </tr>
                  <tr>
                    <th>Data</th>
                    <th>NF</th>
                    <th>Tipo NF</th>
                    <th>Empresa</th>
                    <th>CFOP</th>
                    <th>Operação</th>
                    <th>Estab.</th>
                    <th>Item</th>
                    <th className="num">Valor (R$)</th>
                    <th className="inicio-retorno">Data</th>
                    <th>NF</th>
                    <th>CFOP</th>
                    <th>Item</th>
                    <th className="num">Valor (R$)</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="t-sub" style={{ textAlign: "center" }}>
                        Nenhuma remessa com esses filtros.
                      </td>
                    </tr>
                  ) : (
                    linhas.map((r) => {
                      const situacao = situacoes.get(r.chave) ?? { pendentes: [], tratados: [] };
                      const daLinha = situacao.pendentes;
                      const temAlerta = daLinha.length + situacao.tratados.length > 0;
                      return (
                        <Fragment key={`${r.lado}-${r.id}`}>
                          <tr
                            className={
                              [classeLinha(r), daLinha.length > 0 ? "com-alerta" : ""].filter(Boolean).join(" ") ||
                              undefined
                            }
                            {...(podeEditar ? sobre(r) : {})}
                          >
                            <td className="nowrap">
                              {temAlerta && (
                                <button
                                  type="button"
                                  className={daLinha.length > 0 ? "alerta-sinal" : "alerta-sinal tratado"}
                                  title={textoAlertas(situacao).join("\n") + "\n\nClique para ver, tratar e o histórico."}
                                  aria-label="Ver alertas da remessa"
                                  aria-expanded={aberta === r.chave}
                                  onClick={() => setAberta(aberta === r.chave ? null : r.chave)}
                                >
                                  {daLinha.length > 0 ? "!" : "✓"}
                                </button>
                              )}
                              {dataBR(r.dataEmissao)}
                            </td>
                            <td>{r.numero ?? "—"}</td>
                            <td>{TIPO_NF[r.lado]}</td>
                            <td className="empresa" title={r.contraparte ?? undefined}>
                              {r.contraparte ?? "—"}
                            </td>
                            <td>{r.cfops.join(", ")}</td>
                            <td className="operacao" title={r.natureza ?? undefined}>
                              {operacaoCurta(r.natureza)}
                              {r.lado === "recebida" ? " (recebido)" : ""}
                            </td>
                            <td>{nomeEstab(r.estabelecimento)}</td>
                            <td className="item" title={r.itens.join("\n")}>
                              {r.itens.slice(0, ITENS_VISIVEIS).map((item, i) => (
                                <div key={i} className="item-linha">
                                  {item}
                                </div>
                              ))}
                              {r.itens.length > ITENS_VISIVEIS && (
                                <div className="t-sub">+ {r.itens.length - ITENS_VISIVEIS} item(ns)</div>
                              )}
                            </td>
                            <td className="num">{numeroBR(r.valor)}</td>
                            <td className="inicio-retorno">
                              {r.retornos.map((x) => (
                                <div key={x.chave} className="retorno-linha">
                                  {dataBR(x.dataEmissao)}
                                </div>
                              ))}
                            </td>
                            <td>
                              {r.retornos.map((x) => (
                                <div
                                  key={x.chave}
                                  className="retorno-linha"
                                  title={
                                    x.origem === "nota" ? "A própria nota de retorno cita esta remessa" : "Ligado à mão"
                                  }
                                >
                                  {x.numero ?? "—"}
                                  {x.origem === "manual" && <span className="t-sub"> · à mão</span>}
                                </div>
                              ))}
                            </td>
                            <td>
                              {r.retornos.map((x) => (
                                <div key={x.chave} className="retorno-linha">
                                  {x.cfops.join(", ")}
                                </div>
                              ))}
                            </td>
                            <td className="item">
                              {r.retornos.map((x) => (
                                <div key={x.chave} className="retorno-linha item-linha" title={x.itens.join("\n")}>
                                  {resumoItens(x.itens)}
                                </div>
                              ))}
                            </td>
                            <td className="num">
                              {r.retornos.map((x) => (
                                <div key={x.chave} className="retorno-linha">
                                  {numeroBR(x.valor)}
                                  {podeEditar && (
                                    <button
                                      type="button"
                                      className="vinculo-desfazer"
                                      title="Desfazer o vínculo deste retorno"
                                      aria-label={`Desfazer o vínculo do retorno ${x.numero ?? ""}`}
                                      onClick={() => desfazer(r, x)}
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              ))}
                            </td>
                            <td className="nowrap">
                              <span
                                className={SITUACAO_RETORNO[r.retorno].classe}
                                title={SITUACAO_RETORNO[r.retorno].ajuda}
                              >
                                {SITUACAO_RETORNO[r.retorno].rotulo}
                              </span>
                              {r.diasEmAberto !== null && r.retorno !== "retornada" && (
                                <span className="t-sub" title={`Remessa em aberto há ${r.diasEmAberto} dia(s)`}>
                                  {" "}
                                  {r.diasEmAberto} d
                                </span>
                              )}
                            </td>
                          </tr>
                          {aberta === r.chave && temAlerta && (
                            <tr className="alertas-detalhe-linha">
                              <td colSpan={15}>
                                <AlertasDaRemessa
                                  situacao={situacao}
                                  historico={log.filter((h) => h.remessaChave === r.chave)}
                                  podeEditar={podeEditar}
                                  onRegistrar={(regra, acao, observacao) =>
                                    registrarAlerta(r.chave, regra, acao, observacao)
                                  }
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {podeEditar && (
          <aside className="panel retornos-coluna">
            <div className="panel-head">
              <div className="panel-title">Notas de retorno</div>
              <div className="sub">{listaRetornos.length} nota(s) · arraste para a remessa</div>
            </div>
            <div className="retornos-filtro">
              <div className="field">
                <input
                  type="search"
                  placeholder="Empresa ou nº da nota"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  aria-label="Buscar nota de retorno"
                />
              </div>
              <label className="retornos-check">
                <input
                  type="checkbox"
                  checked={mostrarVinculados}
                  onChange={(e) => setMostrarVinculados(e.target.checked)}
                />{" "}
                Mostrar também as já ligadas
              </label>
            </div>
            <div className="retornos-lista">
              {listaRetornos.length === 0 ? (
                <p className="t-sub" style={{ padding: "8px 4px" }}>
                  {mostrarVinculados || busca
                    ? "Nenhuma nota de retorno com essa busca."
                    : "Todas as notas de retorno do período já estão ligadas a uma remessa."}
                </p>
              ) : (
                listaRetornos.map((r) => (
                  <div
                    key={`${r.fecha}-${r.chave}`}
                    className={r.vinculos > 0 ? "retorno-cartao ja-ligado" : "retorno-cartao"}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", r.chave);
                      e.dataTransfer.effectAllowed = "link";
                      setArrastando(r);
                      setErro(null);
                    }}
                    onDragEnd={() => {
                      setArrastando(null);
                      setAlvo(null);
                    }}
                    title={`${r.contraparte ?? ""} — fecha remessa de ${r.fecha === "enviada" ? "saída" : "entrada"}`}
                  >
                    <div className="linha1">
                      <span>
                        {!r.cfopConfere && (
                          <span
                            className="alerta-sinal"
                            title="CFOP do retorno não confere: a descrição da nota diz retorno, mas o CFOP não é de retorno."
                          >
                            !
                          </span>
                        )}
                        NF {r.numero ?? "—"}
                      </span>
                      <span>{dataBR(r.dataEmissao)}</span>
                    </div>
                    <div className="linha2">{r.contraparte ?? "—"}</div>
                    <div className="linha-item" title={r.itens.join("\n")}>
                      {resumoItens(r.itens)}
                    </div>
                    <div className="linha3">
                      <span>
                        {r.cfops.join(", ")} · {nomeEstab(r.estabelecimento)}
                      </span>
                      <span>{numeroBR(r.valor)}</span>
                    </div>
                    <div className="linha4">
                      Fecha remessa de {r.fecha === "enviada" ? "saída" : "entrada"}
                      {r.vinculos > 0 ? ` · já ligada a ${r.vinculos}` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}

// A tela muda na hora; a resposta do servidor substitui este estado.
function reduzir(atual: Estado, acao: Acao): Estado {
  if (acao.tipo === "vincular") {
    const novo: RetornoDaRemessa = {
      chave: acao.retorno.chave,
      numero: acao.retorno.numero,
      dataEmissao: acao.retorno.dataEmissao,
      cfops: acao.retorno.cfops,
      itens: acao.retorno.itens,
      valor: acao.retorno.valor,
      origem: "manual",
      cfopConfere: acao.retorno.cfopConfere,
      documento: acao.retorno.documento,
    };
    return {
      rows: atual.rows.map((r) => (r.chave === acao.remessaChave ? comRetornos(r, [...r.retornos, novo]) : r)),
      retornos: atual.retornos.map((x) => (x.chave === acao.retorno.chave ? { ...x, vinculos: x.vinculos + 1 } : x)),
    };
  }
  return {
    rows: atual.rows.map((r) =>
      r.chave === acao.remessaChave
        ? comRetornos(
            r,
            r.retornos.filter((x) => x.chave !== acao.retornoChave),
          )
        : r,
    ),
    retornos: atual.retornos.map((x) =>
      x.chave === acao.retornoChave ? { ...x, vinculos: Math.max(0, x.vinculos - 1) } : x,
    ),
  };
}

// Mesma regra do servidor: os retornos cobrem o valor = retornada.
function comRetornos(r: LinhaRemessa, retornos: RetornoDaRemessa[]): LinhaRemessa {
  const voltou = retornos.reduce((s, x) => s + Number(x.valor), 0);
  const situacao: SituacaoRetorno =
    retornos.length === 0 ? "aberta" : voltou >= Number(r.valor) - 0.01 ? "retornada" : "parcial";
  return { ...r, retornos, retorno: situacao, valorRetornado: voltou.toFixed(2) };
}
