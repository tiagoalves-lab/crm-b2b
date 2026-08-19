import { notFound } from "next/navigation";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { getEgestorContato } from "@/lib/api/egestor";
import CorrectForm from "@/app/dashboard/integracao-egestor/[id]/corrigir/correct-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function CorrigirContatoModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const [me, row] = await Promise.all([getMe(token), getEgestorContato(token, id)]);

  if (!row) notFound();

  const canManage = me.membership.role === "owner" || me.membership.role === "admin";

  return (
    <OverlayModal title={`Corrigir divergência — ${row.cpfCnpj}`}>
      {canManage ? (
        <CorrectForm row={row} />
      ) : (
        <div className="error-banner">Só owner/admin podem corrigir divergências no eGestor.</div>
      )}
    </OverlayModal>
  );
}
