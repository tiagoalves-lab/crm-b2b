import { notFound } from "next/navigation";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { getEgestorContato } from "@/lib/api/egestor";
import CorrectForm from "./correct-form";

export default async function CorrigirContatoPage({
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
    <div className="content">
      <div className="page-title">Corrigir divergência — {row.cpfCnpj}</div>
      {canManage ? (
        <CorrectForm row={row} />
      ) : (
        <div className="error-banner">Só owner/admin podem corrigir divergências no eGestor.</div>
      )}
    </div>
  );
}
