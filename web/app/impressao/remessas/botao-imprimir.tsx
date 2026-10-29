"use client";

// Abre a janela de impressão do navegador — é nela que se escolhe
// "Salvar como PDF".
export default function BotaoImprimir() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      Imprimir / Salvar em PDF
    </button>
  );
}
