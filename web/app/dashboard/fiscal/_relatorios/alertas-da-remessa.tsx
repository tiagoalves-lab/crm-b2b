"use client";

import { useState } from "react";
import type { RegistroAlerta } from "@/lib/api/fiscal";
import { formatDateTimeBR } from "@/lib/format-date";
import { REGRAS_ALERTA, type SituacaoAlertas } from "./alertas-remessa";

// Detalhe dos alertas de uma remessa (decisão 7.7), aberto pelo sinal da
// linha: cada alerta com a situação (pendente ou tratado), o botão de
// tratar — com a observação do que foi feito — ou de reabrir, e o
// histórico de tudo que já se fez nos alertas dessa remessa.

export default function AlertasDaRemessa({
  situacao,
  historico,
  podeEditar,
  onRegistrar,
}: {
  situacao: SituacaoAlertas;
  // log desta remessa, do mais antigo pro mais novo
  historico: RegistroAlerta[];
  podeEditar: boolean;
  onRegistrar: (regra: string, acao: RegistroAlerta["acao"], observacao: string) => void;
}) {
  const [tratando, setTratando] = useState<string | null>(null);
  const [observacao, setObservacao] = useState("");

  const ultimo = (codigo: string) => [...historico].reverse().find((h) => h.regra === codigo);
  const rotulo = (codigo: string) => REGRAS_ALERTA.find((a) => a.codigo === codigo)?.rotulo ?? codigo;

  function salvar(codigo: string) {
    if (!observacao.trim()) return;
    onRegistrar(codigo, "tratar", observacao.trim());
    setTratando(null);
    setObservacao("");
  }

  return (
    <div className="alertas-detalhe">
      <div className="alertas-detalhe-lista">
        {[...situacao.pendentes, ...situacao.tratados].map((a) => {
          const tratado = situacao.tratados.includes(a);
          const registro = tratado ? ultimo(a.codigo) : undefined;
          return (
            <div key={a.codigo} className={tratado ? "alerta-item tratado" : "alerta-item"}>
              <div className="alerta-item-cabeca">
                <span className={tratado ? "alerta-sinal tratado" : "alerta-sinal"} aria-hidden="true">
                  {tratado ? "✓" : "!"}
                </span>
                <strong>{a.rotulo}</strong>
                <span className="t-sub">{tratado ? "Tratado" : "Pendente"}</span>
                {podeEditar && tratando !== a.codigo && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      if (tratado) {
                        onRegistrar(a.codigo, "reabrir", "");
                      } else {
                        setTratando(a.codigo);
                        setObservacao("");
                      }
                    }}
                  >
                    {tratado ? "Reabrir" : "Marcar como tratado"}
                  </button>
                )}
              </div>
              <div className="t-sub">{a.ajuda}</div>
              {registro && (
                <div className="alerta-item-registro">
                  {registro.autor} · {formatDateTimeBR(registro.criadoEm)} — {registro.observacao}
                </div>
              )}
              {tratando === a.codigo && (
                <div className="alerta-item-form field">
                  <textarea
                    rows={2}
                    maxLength={1000}
                    placeholder="O que foi feito? (ex.: conferido com o fiscal, nota de retorno pedida ao cliente)"
                    value={observacao}
                    onChange={(e) => setObservacao(e.target.value)}
                    autoFocus
                  />
                  <div className="alerta-item-acoes">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!observacao.trim()}
                      onClick={() => salvar(a.codigo)}
                    >
                      Salvar
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setTratando(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="alertas-historico">
        <div className="alertas-historico-titulo">Histórico</div>
        {historico.length === 0 ? (
          <p className="t-sub">Nenhum alerta tratado nesta remessa ainda.</p>
        ) : (
          <ul>
            {[...historico].reverse().map((h, i) => (
              <li key={`${h.criadoEm}-${i}`}>
                <span className="t-sub">{formatDateTimeBR(h.criadoEm)}</span> · <strong>{h.autor}</strong>{" "}
                {h.acao === "tratar" ? "tratou" : "reabriu"} “{rotulo(h.regra)}”
                {h.observacao ? ` — ${h.observacao}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
