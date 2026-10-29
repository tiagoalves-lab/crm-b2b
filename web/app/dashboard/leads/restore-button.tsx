import ActionForm from "@/app/_components/action-form";
import SubmitButton from "@/app/_components/submit-button";
import { restoreLeadFormAction } from "./actions";

// Botão "Recuperar lead" do cabeçalho da ficha (pedido do usuário,
// 2026-10-19) — aparece no lugar de "Converter lead" quando o lead está
// descartado. No drawer, fecha a ficha ao recuperar (`onSuccess="close"`):
// a ficha recuperada passaria a mostrar "Converter lead" exatamente onde
// este botão estava, e um segundo clique converteria o lead sem querer
// (mesma lição do Concluir/Reabrir da ficha de tarefa).
export default function RestoreLeadButton({
  leadId,
  onSuccess,
}: {
  leadId: string;
  onSuccess: "close" | "stay";
}) {
  return (
    <ActionForm action={restoreLeadFormAction} onSuccess={onSuccess} style={{ marginLeft: "auto" }}>
      <input type="hidden" name="id" value={leadId} />
      <SubmitButton
        className="btn btn-primary btn-sm"
        style={{ width: 150, justifyContent: "center" }}
        pendingLabel="Recuperando…"
      >
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
        Recuperar lead
      </SubmitButton>
    </ActionForm>
  );
}
