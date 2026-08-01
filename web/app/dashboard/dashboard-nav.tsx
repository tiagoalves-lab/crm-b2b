"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Ícones (feather-style, 24x24 viewBox) copiados 1:1 do sidebar de
// gama-crm-mvp.html — mesmo path data, só trocando a tag <svg> pra JSX.
const ICONS: Record<string, React.ReactNode> = {
  painel: (
    <>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </>
  ),
  leads: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />,
  pipeline: (
    <>
      <path d="M3 3v18h18" />
      <path d="M18 9l-5 5-3-3-4 4" />
    </>
  ),
  tarefas: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </>
  ),
  empresas: (
    <>
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
      <path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
    </>
  ),
  relatorios: (
    <>
      <path d="M3 3v18h18" />
      <rect x="7" y="10" width="3" height="7" />
      <rect x="12" y="6" width="3" height="11" />
      <rect x="17" y="13" width="3" height="4" />
    </>
  ),
  membros: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
      <path d="M1 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {ICONS[name]}
    </svg>
  );
}

interface NavCounts {
  leads: number;
  pipeline: number;
  tarefas: number;
  empresas: number;
}

const items = [
  { href: "/dashboard", label: "Painel", group: "Visão geral", icon: "painel", count: undefined },
  { href: "/dashboard/leads", label: "Leads", group: "Aquisição", icon: "leads", count: "leads" as const },
  { href: "/dashboard/pipeline", label: "Pipeline", group: "Vendas", icon: "pipeline", count: "pipeline" as const },
  { href: "/dashboard/empresas", label: "Empresas", group: "Vendas", icon: "empresas", count: "empresas" as const },
  { href: "/dashboard/tarefas", label: "Tarefas", group: "Trabalho", icon: "tarefas", count: "tarefas" as const },
  { href: "/dashboard/relatorios", label: "Relatórios", group: "Trabalho", icon: "relatorios", count: undefined },
  { href: "/dashboard/membros", label: "Membros", group: "Workspace", icon: "membros", count: undefined },
];

export default function DashboardNav({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();
  let lastGroup = "";

  return (
    <nav className="primary-nav" aria-label="Navegação principal">
      {items.map((item) => {
        const showGroup = item.group !== lastGroup;
        lastGroup = item.group;
        const count = item.count ? counts[item.count] : undefined;
        return (
          <div key={item.href}>
            {showGroup && <span className="nav-label">{item.group}</span>}
            <Link
              href={item.href}
              className="nav-item"
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
              {count !== undefined && <span className="nav-badge">{count}</span>}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
