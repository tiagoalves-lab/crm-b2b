import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import MemberEditForm from "@/app/dashboard/membros/member-edit-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function EditarMembroModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const [me, members] = await Promise.all([getMe(token), listMemberships(token)]);
  const member = members.find((m) => m.id === id);
  const canManage = me.membership.role === "owner" || me.membership.role === "admin";

  return (
    <OverlayModal title="Editar membro">
      {error && <div className="error-banner">{error}</div>}
      {!canManage ? (
        <div className="error-banner">Só owner/admin podem editar membros.</div>
      ) : !member ? (
        <div className="error-banner">Membro não encontrado.</div>
      ) : (
        <MemberEditForm member={member} members={members} />
      )}
    </OverlayModal>
  );
}
