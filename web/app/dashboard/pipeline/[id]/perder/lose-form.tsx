import Link from "next/link";
import type { OpportunityDetail } from "../../_detail/load";
import { markLostAction } from "../../actions";

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
export default function LoseForm({ data }: { data: OpportunityDetail }) {
  const { opportunity: o } = data;

  return (
    <form action={markLostAction}>
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
        <Link href={`/dashboard/pipeline/${o.id}`} className="btn btn-ghost">
          Voltar
        </Link>
        <button type="submit" className="btn btn-danger">
          Confirmar perda
        </button>
      </div>
    </form>
  );
}
