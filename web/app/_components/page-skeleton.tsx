// Esqueleto de carregamento das telas do dashboard.
//
// Existe pra ser o corpo de todo `loading.tsx` — o arquivo que o Next
// usa como fallback de Suspense enquanto o Server Component da rota
// busca os dados. Sem ele a navegação fica sem retorno nenhum: o clique
// no menu não muda nada na tela até a resposta chegar, e o usuário
// clica de novo achando que não funcionou.
//
// Server Component puro (sem "use client"): é só markup, a animação é
// CSS (.loading-bar em globals.css).
export default function PageSkeleton() {
  return (
    <div className="loading-state">
      <div className="loading-bar" />
      <div className="loading-bar" />
      <div className="loading-bar" />
      <div className="loading-bar" />
    </div>
  );
}
