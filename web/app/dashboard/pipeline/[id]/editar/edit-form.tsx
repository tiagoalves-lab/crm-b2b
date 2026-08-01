import type { OpportunityDetail } from "../../_detail/load";

// Compartilhado entre a versão full-page e a versão modal do "Editar
// oportunidade" — só etapa/valor/moeda/previsão (a empresa vinculada não
// muda depois de criada; SPEC-CRM-GAMA.md não pede re-vínculo no edit).
export default function EditForm({
  data,
  action,
  backHref,
}: {
  data: OpportunityDetail;
  action: (formData: FormData) => void | Promise<void>;
  backHref?: string;
}) {
  const { opportunity: o, stages } = data;

  return (
    <form action={action} className="form-grid">
      <input type="hidden" name="id" value={o.id} />
      <input type="hidden" name="version" value={o.version} />
      {backHref && <input type="hidden" name="back" value={backHref} />}
      <label>
        Etapa
        <select name="stageId" defaultValue={o.stageId}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Valor
        <input name="amount" type="number" step="0.01" min="0" required defaultValue={o.amount} />
      </label>
      <label>
        Moeda
        <input name="currency" maxLength={3} defaultValue={o.currency} />
      </label>
      <label>
        Previsão de fechamento
        <input name="expectedCloseDate" type="date" defaultValue={o.expectedCloseDate?.slice(0, 10) ?? ""} />
      </label>
      <button type="submit" className="btn btn-primary">
        Salvar
      </button>
    </form>
  );
}
