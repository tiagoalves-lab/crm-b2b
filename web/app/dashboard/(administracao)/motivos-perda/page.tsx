import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listLostReasons } from "@/lib/api/opportunity-lost-reasons";
import MotivosEditor from "./motivos-editor";

// Aba "Motivos de perda" (Administração, 2026-09-17): a lista que aparece
// na janela "Por que a negociação foi perdida?" do card de oportunidade.
// Aqui se cadastra, renomeia e exclui. Renomear leva junto as oportunidades
// já perdidas com o nome antigo; motivo já usado não pode ser excluído.
//
// Só owner/admin — o backend é quem manda (403); este guard é defesa em
// profundidade, mesmo padrão das outras abas.
export default async function MotivosPerdaPage() {
  const token = await getServerAccessToken();
  const me = await getMe(token);
  const podeEditar = me.membership.role === "owner" || me.membership.role === "admin";

  if (!podeEditar) {
    return (
      <div className="content">
        <div className="error-banner">Só owner/admin podem editar os motivos de perda.</div>
      </div>
    );
  }

  const motivos = await listLostReasons(token);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Motivos de perda</div>
          <div className="page-sub">
            Motivos oferecidos ao marcar uma oportunidade como perdida ({motivos.length})
          </div>
        </div>
      </div>
      <div className="content">
        <MotivosEditor motivos={motivos} />
      </div>
    </>
  );
}
