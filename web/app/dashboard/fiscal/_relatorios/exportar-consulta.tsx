"use client";

// "Exportar planilha" da aba Consultar notas: baixa o que está na tabela
// como CSV (separado por ponto e vírgula, com BOM), que o Excel em
// português abre direto com acento e vírgula decimal certos.
export default function ExportarConsulta({ linhas, nome }: { linhas: string[][]; nome: string }) {
  function baixar() {
    const csv = linhas
      .map((l) => l.map((c) => (/[";\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";"))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="btn btn-sm" onClick={baixar} disabled={linhas.length <= 1}>
      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
      </svg>
      Exportar planilha
    </button>
  );
}
