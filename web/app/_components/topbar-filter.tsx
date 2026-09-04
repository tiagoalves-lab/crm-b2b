"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// Caixa de busca do cabeçalho de TODAS as telas (pedido do usuário,
// 2026-09-03, no modelo da "Busca geral" do eGestor). Faz duas coisas:
//
// - **Enquanto digita**: filtra o que já está na tela (linhas de tabela,
//   cards do Pipeline, barras de funil), sem ida ao servidor.
// - **Enter ou a lupa**: abre a Busca geral (/dashboard/busca?q=…), que
//   procura o termo em Empresas, Contatos, Prospecção, Pipeline e Tarefas
//   de uma vez, agrupado por seção.
//
// O filtro local tem dois modos, decididos por quem renderiza:
//
// 1. **DOM (padrão, sem provider)** — procura dentro de `.main` toda linha
//    de `.data-table`, todo card do Pipeline e toda barra de funil
//    (ROW_SELECTOR) e marca `hidden` nas que não batem. Não mexe em estado
//    React de tabela nenhuma: serve pra tabela renderizada no servidor
//    (Membros, histórico eGestor) e pra client component sem seleção em
//    lote (Tarefas, Painel). Um MutationObserver reaplica o filtro quando
//    a lista re-renderiza. React nunca toca no atributo `hidden` desses
//    elementos, então não há disputa.
//
// 2. **Contexto (dentro de TopbarFilterProvider)** — a caixa só guarda o
//    texto; quem filtra é a própria tabela, via useTopbarQuery(). É o modo
//    obrigatório pra tela com seleção em lote (Prospecção, Integração
//    eGestor): esconder linha por DOM deixaria uma linha marcada e
//    invisível entrar numa ação em massa — a tabela precisa saber do
//    filtro pra zerar a seleção. Também é o modo do Pipeline e de
//    Empresas, que já filtravam no estado (contagem/soma das colunas
//    precisam bater).
//
// `localFilter={false}` desliga o filtro-enquanto-digita (usado na própria
// tela de Busca geral: ali digitar é preparar a próxima busca, não sumir
// com os resultados atuais).

const FilterContext = createContext<{
  query: string;
  setQuery: (value: string) => void;
} | null>(null);

export function TopbarFilterProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  return <FilterContext.Provider value={{ query, setQuery }}>{children}</FilterContext.Provider>;
}

// Texto atual do filtro (vazio fora de um provider).
export function useTopbarQuery(): string {
  return useContext(FilterContext)?.query ?? "";
}

// Comparação sem acento e sem caixa — "sao paulo" acha "São Paulo".
export function normalizeForFilter(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function buscaGeralHref(term: string): string {
  return `/dashboard/busca?q=${encodeURIComponent(term.trim())}`;
}

const ROW_SELECTOR = ".main .data-table tbody tr, .main .board .card, .main .fbar";

// Linha de mensagem ("Nenhuma tarefa", "Carregando…"): uma célula só
// ocupando a largura toda — nunca é escondida, senão a tabela some sem
// explicação quando nada bate.
function isMessageRow(el: HTMLElement): boolean {
  if (el.tagName !== "TR" || el.children.length !== 1) return false;
  const cell = el.children[0];
  return cell instanceof HTMLTableCellElement && cell.colSpan > 1;
}

export default function TopbarFilter({
  placeholder,
  initialQuery = "",
  localFilter = true,
}: {
  placeholder?: string;
  // Termo já buscado (tela de Busca geral) — a caixa abre preenchida.
  initialQuery?: string;
  localFilter?: boolean;
}) {
  const router = useRouter();
  const ctx = useContext(FilterContext);
  const [local, setLocal] = useState(initialQuery);
  const query = ctx ? ctx.query : local;
  const setQuery = ctx ? ctx.setQuery : setLocal;
  const domMode = ctx === null && localFilter;

  useEffect(() => {
    if (!domMode) return;
    const root = document.querySelector<HTMLElement>(".main");
    if (!root) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const needle = normalizeForFilter(query.trim());
      root.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach((el) => {
        const show =
          needle === "" ||
          isMessageRow(el) ||
          normalizeForFilter(el.textContent ?? "").includes(needle);
        if (el.hidden === show) el.hidden = !show;
      });
    };
    apply();

    // Reaplica quando a lista muda (uma vez por frame, não por mutação).
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(apply);
    });
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      // Ao trocar de tela ou limpar o texto, tudo volta a aparecer.
      root.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach((el) => {
        if (el.hidden) el.hidden = false;
      });
    };
  }, [domMode, query]);

  function buscarEmTudo() {
    const term = query.trim();
    if (term.length < 2) return;
    router.push(buscaGeralHref(term));
  }

  return (
    <div className="topbar-filter">
      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            buscarEmTudo();
          }
        }}
        placeholder={placeholder ?? "Buscar cliente, contato, oportunidade, tarefa… (Enter busca em tudo)"}
        aria-label="Buscar"
        autoComplete="off"
      />
      <button
        type="button"
        className="topbar-filter-go"
        onClick={buscarEmTudo}
        disabled={query.trim().length < 2}
        title="Buscar em tudo (Enter)"
        aria-label="Buscar em tudo"
      >
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </button>
    </div>
  );
}
