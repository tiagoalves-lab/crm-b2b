import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import MemberForm from "../member-form";

// Fallback full-page (acesso direto/refresh em /dashboard/membros/novo).
// Em navegação normal dentro do app, essa mesma rota é interceptada e
// aparece como modal — ver web/app/dashboard/@modal/(.)membros/novo.
export default async function NovoMembroPage({
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

  if (!canCreate) {
    return (
      <>
        <div className="topbar">
          <div>
            <div className="page-title">Novo membro</div>
            <div className="page-sub">Sem permissão</div>
          </div>
          <Link href="/dashboard/membros" className="btn btn-ghost btn-sm">
            ✕ Cancelar
          </Link>
        </div>
        <div className="content">
          <div className="error-banner">
            Só owner/admin/gerente podem cadastrar membros.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Novo membro</div>
          <div className="page-sub">Cria o acesso (login e senha)</div>
        </div>
        <Link href="/dashboard/membros" className="btn btn-ghost btn-sm">
          ✕ Cancelar
        </Link>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="form-panel">
          <MemberForm members={members} actorRole={me.membership.role} />
        </div>
      </div>
    </>
  );
}
