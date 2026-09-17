"use client";

import { useEffect, useRef } from "react";

// Visualizador dos slides de treinamento (2026-09-17). O conteúdo vem
// pronto em HTML/CSS (conteudo.ts) e é montado dentro de um Shadow DOM:
// o CSS dos slides não vaza pro CRM (classes como .pill e .note existem
// nos dois) e o CSS do CRM não deforma os slides.
//
// A navegação (índice, anterior/próximo, setas do teclado, "Ver todos")
// era um <script> na página avulsa — aqui virou este efeito, porque a CSP
// do CRM bloqueia script inline.
export default function SlidesViewer({ html, css }: { html: string; css: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${css}</style><div class="raiz">${html}</div>`;

    const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
    const stage = q<HTMLElement>("#stage");
    const toc = q<HTMLOListElement>("#toc");
    const count = q<HTMLElement>("#count");
    const prog = q<HTMLElement>("#prog");
    const modeOne = q<HTMLButtonElement>("#modeOne");
    const modeAll = q<HTMLButtonElement>("#modeAll");
    if (!stage || !toc || !count || !prog || !modeOne || !modeAll) return;

    const slides = Array.from(stage.querySelectorAll<HTMLElement>(".slide"));
    const cores: Record<string, string> = {
      Abertura: "var(--accent)",
      Prospecção: "var(--c-prosp)",
      Pipeline: "var(--c-pipe)",
      Tarefas: "var(--c-tar)",
      Empresas: "var(--c-emp)",
      Encerramento: "var(--accent)",
    };
    const botoes: HTMLButtonElement[] = [];
    let atual = 0;
    let ultimoGrupo: string | null = null;

    const ir = (i: number, rolar: boolean) => {
      atual = Math.max(0, Math.min(slides.length - 1, i));
      slides.forEach((s, k) => s.classList.toggle("on", k === atual));
      botoes.forEach((b, k) => b.setAttribute("aria-current", k === atual ? "true" : "false"));
      count.textContent = `${atual + 1} de ${slides.length}`;
      prog.style.width = `${((atual + 1) / slides.length) * 100}%`;
      if (rolar) {
        const alvo = stage.classList.contains("all") ? slides[atual] : host;
        alvo.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    };

    slides.forEach((s, i) => {
      const n = s.querySelector(".eyebrow .n");
      if (n) n.textContent = `${i + 1} / ${slides.length}`;
      const grupo = s.dataset.grp ?? "";
      if (grupo !== ultimoGrupo) {
        const li = document.createElement("li");
        li.className = "grp";
        const marca = document.createElement("i");
        marca.style.background = cores[grupo] ?? "var(--accent)";
        li.append(marca, grupo);
        toc.appendChild(li);
        ultimoGrupo = grupo;
      }
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const num = document.createElement("span");
      num.textContent = String(i + 1);
      b.append(num, s.dataset.t ?? "");
      b.addEventListener("click", () => ir(i, true));
      li.appendChild(b);
      toc.appendChild(li);
      botoes.push(b);
    });

    const modo = (todos: boolean) => {
      stage.classList.toggle("one", !todos);
      stage.classList.toggle("all", todos);
      modeOne.setAttribute("aria-pressed", String(!todos));
      modeAll.setAttribute("aria-pressed", String(todos));
      try {
        localStorage.setItem("treino-modo", todos ? "all" : "one");
      } catch {}
    };

    q<HTMLButtonElement>("#prev")?.addEventListener("click", () => ir(atual - 1, false));
    q<HTMLButtonElement>("#next")?.addEventListener("click", () => ir(atual + 1, false));
    modeOne.addEventListener("click", () => modo(false));
    modeAll.addEventListener("click", () => modo(true));

    // Setas só quando ninguém está digitando (a busca do topo é do CRM).
    const teclado = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        ir(atual + 1, false);
        e.preventDefault();
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        ir(atual - 1, false);
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", teclado);

    try {
      if (localStorage.getItem("treino-modo") === "all") modo(true);
    } catch {}
    ir(0, false);

    return () => document.removeEventListener("keydown", teclado);
  }, [html, css]);

  return <div ref={hostRef} style={{ minHeight: 400 }} />;
}
