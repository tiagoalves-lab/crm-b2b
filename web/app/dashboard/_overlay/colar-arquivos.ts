"use client";

import { useEffect, useRef } from "react";

// Anexar com Ctrl+V (pedido do usuário, 2026-10-28): print da tela, PDF
// ou qualquer arquivo copiado no Explorer cai direto como anexo.
//
// Um único ouvinte no documento, com uma PILHA de quem quer receber: só
// o último montado leva o arquivo. Assim "Nova tarefa" aberta por cima
// do card de Oportunidade não anexa a mesma coisa nos dois.
//
// Colar texto continua sendo colar texto: se o foco está num campo de
// digitação e a área de transferência também traz texto (célula do
// Excel, trecho do Word — que vêm com uma imagem junto), vale o texto.

type Receptor = { current: (files: File[]) => void };

const pilha: Receptor[] = [];

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

// Print colado chega como "image.png" — todo print teria o mesmo nome.
// Vira "print-2026-10-28-14h05m33s.png"; arquivo copiado do Explorer
// mantém o nome original.
function renomear(file: File, indice: number, total: number): File {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file;
  const agora = new Date();
  const data = `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`;
  const hora = `${doisDigitos(agora.getHours())}h${doisDigitos(agora.getMinutes())}m${doisDigitos(agora.getSeconds())}s`;
  const extensao = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const sufixo = total > 1 ? `-${indice + 1}` : "";
  return new File([file], `print-${data}-${hora}${sufixo}.${extensao}`, { type: file.type });
}

function aoColar(event: ClipboardEvent) {
  const topo = pilha[pilha.length - 1];
  const dados = event.clipboardData;
  if (!topo || !dados) return;
  const files = Array.from(dados.files);
  if (files.length === 0) return;

  const alvo = event.target;
  const digitando =
    alvo instanceof HTMLTextAreaElement ||
    (alvo instanceof HTMLInputElement && alvo.type !== "file") ||
    (alvo instanceof HTMLElement && alvo.isContentEditable);
  if (digitando && dados.getData("text/plain").trim() !== "") return;

  event.preventDefault();
  topo.current(files.map((file, i) => renomear(file, i, files.length)));
}

export function useColarArquivos(onFiles: (files: File[]) => void) {
  const receptor = useRef(onFiles);
  receptor.current = onFiles;

  useEffect(() => {
    const atual = receptor;
    pilha.push(atual);
    if (pilha.length === 1) document.addEventListener("paste", aoColar);
    return () => {
      const i = pilha.indexOf(atual);
      if (i >= 0) pilha.splice(i, 1);
      if (pilha.length === 0) document.removeEventListener("paste", aoColar);
    };
  }, []);
}
