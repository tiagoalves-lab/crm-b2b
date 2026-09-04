"use client";

import { useRouter } from "next/navigation";
import type { OpportunityDetail } from "../../_detail/load";
import { markLostFormAction } from "../../actions";
import ActionForm from "@/app/_components/action-form";
import SubmitButton from "@/app/_components/submit-button";

const MOTIVOS = [
  "Preço / concorrente",
  "Sem orçamento no momento",
  "Prazo de entrega",
  "Optou por terceirizar",
  "Sem retorno / esfriou",
  "Outro",
];

// Compartilhado entre a versão full-page e a versão modal de "Marcar como
// perdida" (protótipo: askLoseDeal, segundo passo de winDeal/loseDeal).
//
// 2026-09-03: ActionForm no lugar de <form action> com redirect —
// confirmar fecha este modal com router.back() e o card de trás (já como
// "Perdida") recebe refresh ao chegar. "Voltar" também é router.back():
// link pra URL do card não colapsa o slot do modal.
export default function LoseForm({ data }: { data: OpportunityDetail }) {
  const router = useRouter();
  const { opportunity: o } = data;

  return (
    <ActionForm action={markLostFormAction} onSuccess="close">
      <input type="hidden" name="id" value={o.id} />
      <input type="hidden" name="version" value={o.version} />
      <div className="field">
        <label>Motivo da perda</label>
        <select name="lostReason" defaultValue={MOTIVOS[0]}>
          {MOTIVOS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="field-hint">
        Registrar o motivo ajuda a entender por que perdemos e melhora a abordagem.
      </div>
      <div className="modal-foot" style={{ padding: "16px 0 0" }}>
        <button type="button" className="btn btn-ghost" onClick={() => router.back()}>
          Voltar
        </button>
        <SubmitButton className="btn btn-danger" pendingLabel="Confirmando…">
          Confirmar perda
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
