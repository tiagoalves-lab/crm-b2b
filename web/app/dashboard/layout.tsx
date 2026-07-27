import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { signOut } from "../login/actions";
import DashboardNav from "./dashboard-nav";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Gerente",
  sales_rep: "Representante",
  readonly: "Leitura",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const token = await getServerAccessToken();
  const me = await getMe(token);
  const roleLabel = ROLE_LABELS[me.membership.role] ?? me.membership.role;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="workspace-switch">
          <div className="mark">GB</div>
          <div>
            <div className="name">Gama Brasil</div>
            <div className="plan">{roleLabel}</div>
          </div>
        </div>

        <DashboardNav />

        <form action={signOut} className="sidebar-footer">
          <div className="avatar">{initials(user.email)}</div>
          <div className="who-wrap">
            <div className="who">{user.email}</div>
            <button type="submit" className="logout-link">
              Sair
            </button>
          </div>
        </form>
      </aside>

      <div className="main">{children}</div>
    </div>
  );
}

function initials(email?: string | null) {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}
