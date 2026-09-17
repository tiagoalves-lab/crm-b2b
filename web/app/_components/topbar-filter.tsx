"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { screenLabelFor } from "@/app/dashboard/nav-items";

// Caixa de busca do cabeçalho de TODAS as telas (pedido do usuário,
// 2026-09-03, no modelo da "Busca geral" do eGestor). Faz duas coisas:
//
// - **Enquanto digita**: filtra o que já está na tela (linhas de tabela,
//   cards do Pipeline, barras de funil), sem ida ao servidor.
// - **Enter ou a lupa**: abre a Busca geral (/dashboard/busca?q=…), que
//   procura o termo em Empresas, Contatos, Prospecção, Pipeline e Tarefas
//   de uma vez, agrupado por seção.
//
// Qual dos dois acontece é o **escopo**, escolhido no seletor dentro da
// própria caixa (pedido do usuário, 2026-09-15, no modelo do Mercado
// Livre): "em <tela atual>" (padrão) ou "em todo o CRM". No escopo da
// tela, digitar filtra e o Enter não sai do lugar; no escopo global o
// filtro local é desligado (a tela para de esconder linhas) e o Enter/a
// lupa abrem a Busca geral. Trocar pra "em todo o CRM" com o termo já
// digitado busca na hora, sem precisar de um segundo Enter.
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
// com os resultados atuais — e o escopo já é o CRM inteiro, então o
// seletor nem aparece).

const FilterContext = createContext<{
  query: string;
  setQuery: (value: string) => void;
} | null>(null);

export function TopbarFilterProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  return <FilterContext.Provider value={{ query, setQuery }}>{children}</FilterContext.Provider>;
}

// Texto atual do filtro (vazio fora de um provider, e também quando o
// escopo é "em todo o CRM" — aí a tela não filtra nada).
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
  const pathname = usePathname();
  const ctx = useContext(FilterContext);
  const setCtxQuery = ctx?.setQuery;

  const [text, setText] = useState(initialQuery);
  const [scope, setScope] = useState<"tela" | "tudo">("tela");

  // Sem nome de tela (Busca geral) ou sem filtro local não há o que
  // escolher: o escopo é o CRM inteiro e o seletor não aparece.
  const screenLabel = localFilter ? screenLabelFor(pathname) : null;
  const filtering = screenLabel !== null && scope === "tela";
  const domMode = ctx === null && filtering;

  // Modo contexto: a tabela lê o texto daqui. No escopo global mandamos
  // vazio, senão a tela continuaria escondendo linhas por trás da busca.
  useEffect(() => {
    if (!setCtxQuery) return;
    setCtxQuery(filtering ? text : "");
  }, [setCtxQuery, filtering, text]);

  useEffect(() => {
    if (!domMode) return;
    const root = document.querySelector<HTMLElement>(".main");
    if (!root) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const needle = normalizeForFilter(text.trim());
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
      // Ao trocar de tela, de escopo ou limpar o texto, tudo reaparece.
      root.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach((el) => {
        if (el.hidden) el.hidden = false;
      });
    };
  }, [domMode, text]);

  function buscarEmTudo(term: string) {
    if (term.trim().length < 2) return;
    router.push(buscaGeralHref(term));
  }

  function submit() {
    // Escopo "nesta tela" já filtrou enquanto digitava — Enter não navega.
    if (filtering) return;
    buscarEmTudo(text);
  }

  return (
    <div className="topbar-filter">
      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder ?? "Buscar cliente, contato, oportunidade, tarefa…"}
        aria-label="Buscar"
        autoComplete="off"
      />
      {screenLabel && (
        <div className="topbar-filter-scope">
          <select
            aria-label="Onde buscar"
            value={scope}
            onChange={(event) => {
              const next = event.target.value === "tudo" ? "tudo" : "tela";
              setScope(next);
              // Já tem termo digitado? Trocar pra "todo o CRM" busca na
              // hora — esperar um Enter extra parece que nada aconteceu.
              if (next === "tudo") buscarEmTudo(text);
            }}
          >
            <option value="tela">em {screenLabel}</option>
            <option value="tudo">em todo o CRM</option>
          </select>
          <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      )}
      <button
        type="button"
        className="topbar-filter-go"
        onClick={submit}
        disabled={!filtering && text.trim().length < 2}
        title={filtering ? `Buscar em ${screenLabel}` : "Buscar em todo o CRM (Enter)"}
        aria-label={filtering ? `Buscar em ${screenLabel}` : "Buscar em todo o CRM"}
      >
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </button>
    </div>
  );
}
