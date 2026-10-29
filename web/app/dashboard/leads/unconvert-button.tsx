import ActionForm from "@/app/_components/action-form";
import ConfirmSubmitButton from "@/app/dashboard/(administracao)/membros/confirm-submit-button";
import { unconvertLeadFormAction } from "./actions";

// Botão "Desconverter lead" (pedido do usuário, 2026-10-27) — aparece na
// ficha do lead convertido, no lugar onde fica o "Converter lead". Mesma
// lição do RestoreLeadButton: no drawer fecha a ficha ao terminar, senão o
// "Converter lead" surgiria no mesmo lugar e um segundo clique
// reconverteria sem querer. Empresa com proposta vinculada é recusada pelo
// backend, e a mensagem aparece em cima do botão.
export default function UnconvertLeadButton({
  leadId,
  onSuccess,
}: {
  leadId: string;
  onSuccess: "close" | "stay";
}) {
  return (
    <ActionForm action={unconvertLeadFormAction} onSuccess={onSuccess} style={{ marginLeft: "auto" }}>
      <input type="hidden" name="id" value={leadId} />
      <ConfirmSubmitButton
        className="btn btn-ghost btn-sm"
        confirmMessage="Desconverter este lead? Ele volta para a Prospecção e sai de Leads convertidos."
        pendingLabel="Desconvertendo…"
      >
        Desconverter lead
      </ConfirmSubmitButton>
    </ActionForm>
  );
}
