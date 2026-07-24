import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import DashboardNav from "./dashboard-nav";

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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="workspace-switch">
          <div className="mark">GB</div>
          <div>
            <div className="name">Gama Brasil</div>
            <div className="plan">Plano Pro</div>
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
