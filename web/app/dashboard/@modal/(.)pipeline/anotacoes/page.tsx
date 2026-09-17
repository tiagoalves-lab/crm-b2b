import { getServerAccessToken } from "@/lib/api/auth";
import AnotacoesLista from "@/app/dashboard/pipeline/_anotacoes/anotacoes-lista";
import { loadAnotacoes } from "@/app/dashboard/pipeline/_anotacoes/load";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

// Histórico de anotações dos cards, aberto pelo ícone da barra da tela
// Pipeline (2026-09-09). Rota interceptada: o quadro continua atrás e
// fechar volta pra ele sem recarregar.
export default async function AnotacoesModal() {
  const token = await getServerAccessToken();
  const { items, memberships } = await loadAnotacoes(token);

  return (
    <OverlayModal title="Histórico de anotações" wide>
      <AnotacoesLista items={items} memberships={memberships} />
    </OverlayModal>
  );
}
