import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import MemberEditForm from "../../member-edit-form";

// Fallback full-page (acesso direto/refresh em /dashboard/membros/[id]/editar).
// Em navegação normal dentro do app, essa mesma rota é interceptada e
// aparece como modal — ver web/app/dashboard/@modal/(.)membros/[id]/editar.
export default async function EditarMembroPage({
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

  if (!canManage || !member) {
    return (
      <>
        <div className="topbar">
          <div>
            <div className="page-title">Editar membro</div>
            <div className="page-sub">{canManage ? "Membro não encontrado" : "Sem permissão"}</div>
          </div>
          <Link href="/dashboard/membros" className="btn btn-ghost btn-sm">
            ✕ Cancelar
          </Link>
        </div>
        <div className="content">
          <div className="error-banner">
            {canManage ? "Membro não encontrado." : "Só owner/admin podem editar membros."}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Editar membro</div>
          <div className="page-sub">Papel, gerente e status</div>
        </div>
        <Link href="/dashboard/membros" className="btn btn-ghost btn-sm">
          ✕ Cancelar
        </Link>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="form-panel">
          <MemberEditForm member={member} members={members} />
        </div>
      </div>
    </>
  );
}
