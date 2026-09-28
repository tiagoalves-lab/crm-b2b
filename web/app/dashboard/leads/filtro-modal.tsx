"use client";

import { useMemo, useState } from "react";
import { normalizeForFilter } from "@/app/_components/topbar-filter";

// Filtro de tags e segmentos da Prospecção (2026-09-24, pedido do
// usuário: "crie um ícone que abra um modal para filtrar, inclusive mais
// de um").
//
// Antes eram duas fileiras de pastilhas empilhadas em cima da tabela —
// uma por tag, uma por segmento — e só dava pra escolher UMA de cada vez,
// porque cada pastilha era um link que trocava a querystring. Com 27 tags
// a fileira ocupava três linhas da tela e ainda assim não respondia à
// pergunta que o usuário faz ("me mostra os leads do Meta E os da
// planilha").
//
// Agora: um botão só, que diz quantos filtros estão valendo, e um modal
// com caixas de seleção. A escolha é estado no navegador (nada de ida ao
// servidor, mesma decisão das abas) e vale nas duas visões, lista e
// quadro.

// Como combinar várias tags. "qualquer" amplia (é o que se espera ao
// marcar duas caixas), "todas" restringe — útil pra cruzar marcações, ex.:
// quem é do Meta E foi importado da planilha.
export type ModoTag = "qualquer" | "todas";

export interface FiltroTags {
  tags: string[];
  // Caixa "Sem tag": entra em OU com as tags marcadas (marcar "Sem tag" +
  // "Meta Business" mostra os dois conjuntos). Sozinha, mostra só quem
  // não tem tag nenhuma.
  semTag: boolean;
  segmentos: string[];
  modo: ModoTag;
}

export const FILTRO_VAZIO: FiltroTags = {
  tags: [],
  semTag: false,
  segmentos: [],
  modo: "qualquer",
};

export function contarFiltros(f: FiltroTags): number {
  return f.tags.length + f.segmentos.length + (f.semTag ? 1 : 0);
}

// Aplica o filtro a um lead. Fica aqui, junto da definição, pra lista e
// quadro nunca discordarem do que o modal diz estar valendo.
export function leadPassaNoFiltro(
  lead: { tags: string[]; segmento: string | null },
  f: FiltroTags,
): boolean {
  if (f.segmentos.length > 0 && (!lead.segmento || !f.segmentos.includes(lead.segmento))) {
    return false;
  }
  if (f.tags.length === 0 && !f.semTag) return true;

  const casaSemTag = f.semTag && lead.tags.length === 0;
  const casaTags =
    f.tags.length > 0 &&
    (f.modo === "todas"
      ? f.tags.every((t) => lead.tags.includes(t))
      : f.tags.some((t) => lead.tags.includes(t)));

  return casaSemTag || casaTags;
}

export default function FiltroModal({
  tagsDisponiveis,
  segmentosDisponiveis,
  contagemPorTag,
  contagemPorSegmento,
  semTagTotal,
  valor,
  onAplicar,
  onFechar,
}: {
  tagsDisponiveis: string[];
  segmentosDisponiveis: string[];
  contagemPorTag: Record<string, number>;
  contagemPorSegmento: Record<string, number>;
  semTagTotal: number;
  valor: FiltroTags;
  onAplicar: (f: FiltroTags) => void;
  onFechar: () => void;
}) {
  // Rascunho: a escolha só vale quando a pessoa aperta Aplicar. Fechar no
  // X ou clicando fora descarta — marcar e desmarcar caixa a caixa com a
  // lista redesenhando embaixo é o que deixava o filtro antigo lento.
  const [rascunho, setRascunho] = useState<FiltroTags>(valor);
  const [busca, setBusca] = useState("");

  const tagsVisiveis = useMemo(() => {
    const needle = normalizeForFilter(busca.trim());
    if (!needle) return tagsDisponiveis;
    return tagsDisponiveis.filter((t) => normalizeForFilter(t).includes(needle));
  }, [tagsDisponiveis, busca]);

  function alternarTag(tag: string) {
    setRascunho((atual) => ({
      ...atual,
      tags: atual.tags.includes(tag)
        ? atual.tags.filter((t) => t !== tag)
        : [...atual.tags, tag],
    }));
  }

  function alternarSegmento(segmento: string) {
    setRascunho((atual) => ({
      ...atual,
      segmentos: atual.segmentos.includes(segmento)
        ? atual.segmentos.filter((s) => s !== segmento)
        : [...atual.segmentos, segmento],
    }));
  }

  const marcados = contarFiltros(rascunho);

  return (
    <div className="overlay open" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Filtrar leads</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="filtro-secao-titulo">
            <span>Tags</span>
            {tagsDisponiveis.length > 8 && (
              <input
                className="filtro-busca"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar tag…"
              />
            )}
          </div>

          {rascunho.tags.length > 1 && (
            <div className="filtro-modo">
              <label>
                <input
                  type="radio"
                  name="modo-tag"
                  checked={rascunho.modo === "qualquer"}
                  onChange={() => setRascunho((a) => ({ ...a, modo: "qualquer" }))}
                />
                Tem <b>qualquer uma</b> das tags marcadas
              </label>
              <label>
                <input
                  type="radio"
                  name="modo-tag"
                  checked={rascunho.modo === "todas"}
                  onChange={() => setRascunho((a) => ({ ...a, modo: "todas" }))}
                />
                Tem <b>todas</b> elas ao mesmo tempo
              </label>
            </div>
          )}

          <div className="filtro-lista">
            <label className="filtro-item">
              <input
                type="checkbox"
                checked={rascunho.semTag}
                onChange={(e) => setRascunho((a) => ({ ...a, semTag: e.target.checked }))}
              />
              <span>Sem tag nenhuma</span>
              <span className="filtro-contagem">{semTagTotal}</span>
            </label>
            {tagsVisiveis.map((tag) => (
              <label key={tag} className="filtro-item">
                <input
                  type="checkbox"
                  checked={rascunho.tags.includes(tag)}
                  onChange={() => alternarTag(tag)}
                />
                <span>{tag}</span>
                <span className="filtro-contagem">{contagemPorTag[tag] ?? 0}</span>
              </label>
            ))}
            {tagsVisiveis.length === 0 && (
              <p className="empty" style={{ margin: 8 }}>
                Nenhuma tag com esse nome.
              </p>
            )}
          </div>

          {segmentosDisponiveis.length > 0 && (
            <>
              <div className="filtro-secao-titulo" style={{ marginTop: 16 }}>
                <span>Segmentos</span>
              </div>
              <div className="filtro-lista">
                {segmentosDisponiveis.map((segmento) => (
                  <label key={segmento} className="filtro-item">
                    <input
                      type="checkbox"
                      checked={rascunho.segmentos.includes(segmento)}
                      onChange={() => alternarSegmento(segmento)}
                    />
                    <span>{segmento}</span>
                    <span className="filtro-contagem">{contagemPorSegmento[segmento] ?? 0}</span>
                  </label>
                ))}
              </div>
              <div className="field-hint" style={{ marginTop: 6 }}>
                Cada lead tem um segmento só — marcar vários mostra todos eles juntos.
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setRascunho(FILTRO_VAZIO)}
            disabled={marcados === 0}
          >
            Limpar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onAplicar(rascunho)}>
            {marcados > 0 ? `Aplicar (${marcados})` : "Aplicar"}
          </button>
        </div>
      </div>
    </div>
  );
}
