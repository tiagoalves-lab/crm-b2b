import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import MemberForm from "@/app/dashboard/membros/member-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function NovoMembroModal({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const [me, members] = await Promise.all([getMe(token), listMemberships(token)]);

  const canCreate =
    me.membership.role === "owner" ||
    me.membership.role === "admin" ||
    me.membership.role === "manager";

  return (
    <OverlayModal title="Novo membro">
      {error && <div className="error-banner">{error}</div>}
      {canCreate ? (
        <MemberForm members={members} actorRole={me.membership.role} />
      ) : (
        <div className="error-banner">
          Só owner/admin/gerente podem cadastrar membros.
        </div>
      )}
    </OverlayModal>
  );
}
