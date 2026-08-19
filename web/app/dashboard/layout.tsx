import { Suspense } from "react";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { getSidebarCounts } from "@/lib/api/counts";
import type { MembershipRole } from "@/lib/api/types";
import { signOut } from "../login/actions";
import DashboardNav from "./dashboard-nav";
import Toast from "./_overlay/toast";
import SubmitButton from "@/app/_components/submit-button";

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
  // protótipo). Vinham de 4 listagens completas contadas em JS aqui —
  // o que fazia toda navegação do CRM baixar a base inteira de empresas
  // (1.165 registros, 12 requisições sequenciais) só pra exibir 4
  // números. Agora é um COUNT por recurso, numa requisição só:
  // GET /counts (src/counts/ no backend, mesmos filtros das telas).
  const [me, counts] = await Promise.all([getMe(token), getSidebarCounts(token)]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="workspace-switch">
          <img
            src="/logo-gama.svg"
            alt="Gama Brasil"
            className="sidebar-logo"
            width={97}
            height={24}
          />
          <span className="sidebar-tagline">CRM</span>
        </div>

        <DashboardNav counts={counts} role={me.membership.role} />

        <div className="sidebar-footer">
          <div className="avatar">{initials(me.user.name ?? me.user.email)}</div>
          <div className="who-wrap">
            <div className="who">{me.user.name ?? me.user.email}</div>
            <div className="who-sub">{ROLE_LABELS[me.membership.role] ?? me.membership.role}</div>
          </div>
          <form action={signOut}>
            <SubmitButton className="logout-link" title="Sair" aria-label="Sair" style={{ marginLeft: 8 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </SubmitButton>
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

function initials(label?: string | null) {
  if (!label) return "?";
  return label.slice(0, 2).toUpperCase();
}
