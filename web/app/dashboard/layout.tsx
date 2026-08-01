import { Suspense } from "react";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listRawLeads } from "@/lib/api/raw-leads";
import { listTasks } from "@/lib/api/tasks";
import type { MembershipRole } from "@/lib/api/types";
import { signOut } from "../login/actions";
import DashboardNav from "./dashboard-nav";
import Toast from "./_overlay/toast";

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Gerente",
  sales_rep: "Representante",
  readonly: "Leitura",
};

export default async function DashboardLayout({
  children,
  modal,
  drawer,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  drawer: React.ReactNode;
}) {
  const token = await getServerAccessToken();

  // Contadores do sidebar (SPEC-CRM-GAMA.md, badges de nav-item no
  // protótipo) — mesmos filtros já usados nas telas próprias de cada
  // recurso (Leads: status=novo; Pipeline: abertas; Tarefas: pendentes;
  // Empresas: exclui tag lead-triagem, igual à tela Empresas).
  const [me, { items: leadsNovos }, { items: opportunities }, { items: tasks }, { items: companies }] =
    await Promise.all([
      getMe(token),
      listRawLeads(token, { status: "novo" }),
      listOpportunities(token),
      listTasks(token, { status: "pending" }),
      listCompanies(token),
    ]);

  const counts = {
    leads: leadsNovos.length,
    pipeline: opportunities.filter((o) => o.status === "open" && !o.deletedAt).length,
    tarefas: tasks.length,
    empresas: companies.filter((c) => !c.tags.includes("lead-triagem") && !c.deletedAt).length,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="workspace-switch">
          <img
            src="/logo-gama-dark.svg"
            alt="Gama Brasil"
            className="sidebar-logo"
            width={97}
            height={24}
          />
        </div>

        <DashboardNav counts={counts} />

        <div className="sidebar-footer">
          <div className="avatar">{initials(me.user.email)}</div>
          <div className="who-wrap">
            <div className="who">{me.user.email}</div>
            <div className="who-sub">{ROLE_LABELS[me.membership.role] ?? me.membership.role}</div>
          </div>
          <form action={signOut}>
            <button type="submit" className="logout-link" title="Sair" aria-label="Sair" style={{ marginLeft: 8 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </form>
        </div>
      </aside>

      <div className="main">{children}</div>

      {modal}
      {drawer}
      <Suspense fallback={null}>
        <Toast />
      </Suspense>
    </div>
  );
}

function initials(email?: string | null) {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}
