"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MembershipRole } from "@/lib/api/types";
import { Icon } from "../dashboard-nav";
import { ADMIN_TABS, pathMatches } from "../nav-items";

// Barra de abas da Administração (pedido do usuário, 2026-09-17), no molde
// da tela Configurações do eGestor: faixa escura, abas em caixa alta com
// ícone, a ativa em verde. Cada aba é uma página própria (a URL de cada
// tela não mudou), a barra só junta todas debaixo do mesmo cabeçalho.
export default function AdminTabs({ role }: { role: MembershipRole }) {
  const pathname = usePathname();
  const abas = ADMIN_TABS.filter((tab) => !tab.roles || tab.roles.includes(role));

  return (
    <div className="admin-head">
      <div className="admin-head-title">Administração</div>
      <nav className="admin-tabs" aria-label="Abas da Administração">
        {abas.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="admin-tab"
            aria-current={pathMatches(pathname, tab.href) ? "page" : undefined}
          >
            <Icon name={tab.icon} />
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
