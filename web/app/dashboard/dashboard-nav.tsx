"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Painel", group: "Visão geral" },
  { href: "/dashboard/leads", label: "Leads", group: "Aquisição" },
  { href: "/dashboard/pipeline", label: "Pipeline", group: "Vendas" },
  { href: "/dashboard/empresas", label: "Empresas", group: "Vendas" },
  { href: "/dashboard/tarefas", label: "Tarefas", group: "Trabalho" },
  { href: "/dashboard/relatorios", label: "Relatórios", group: "Trabalho" },
  { href: "/dashboard/membros", label: "Membros", group: "Workspace" },
];

export default function DashboardNav() {
  const pathname = usePathname();
  let lastGroup = "";

  return (
    <nav className="primary-nav" aria-label="Navegação principal">
      {items.map((item) => {
        const showGroup = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.href}>
            {showGroup && <span className="nav-label">{item.group}</span>}
            <Link
              href={item.href}
              className="nav-item"
              aria-current={pathname === item.href ? "page" : undefined}
            >
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
