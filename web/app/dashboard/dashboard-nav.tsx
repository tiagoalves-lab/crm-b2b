"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IS_BETA } from "@/lib/ambiente";
import { hasPermission } from "@/lib/api/permission-catalog";
import type { MembershipRole, PermissionMatrix } from "@/lib/api/types";
import { NAV_ITEMS, pathMatches } from "./nav-items";

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
  // "user-check" (feather-icons) — Leads convertidos (2026-10-27).
  convertidos: (
    <>
      <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="M17 11l2 2 4-4" />
    </>
  ),
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
  // "mail" (feather-icons) — tela "E-mail automático" (Administração,
  // 2026-09-15): configuração dos relatórios recorrentes por e-mail.
  email: (
    <>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <path d="M22 6l-10 7L2 6" />
    </>
  ),
  // "trash-2" (feather-icons) — Registro de exclusões (2026-09-16).
  exclusoes: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </>
  ),
  // "link-2" (feather-icons) — não existe no protótipo, tela nova
  // (Integração eGestor, docs/roadmap.md itens 9.3/9.6).
  egestor: (
    <>
      <path d="M15 7h3a5 5 0 0 1 0 10h-3" />
      <path d="M9 17H6a5 5 0 0 1 0-10h3" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  // "settings" (feather-icons) — item único "Administração" (2026-09-17).
  admin: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </>
  ),
  // "book-open" (feather-icons) — item Treinamento (2026-09-17).
  treinamento: (
    <>
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </>
  ),
  // "phone" (feather-icons) — aba Telefonia (2026-09-23).
  telefonia: (
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.1 9.9a16 16 0 006 6l1.26-1.26a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
  ),
  // "file-text" (feather-icons) — Console fiscal (2026-10-20).
  fiscal: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </>
  ),
  // "x-octagon" (feather-icons) — aba Motivos de perda (2026-09-17).
  motivos: (
    <>
      <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </>
  ),
};

export function Icon({ name }: { name: string }) {
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
  // Opcional: o backend só passou a mandar em 2026-10-27.
  convertidos?: number;
}

export default function DashboardNav({
  counts,
  role,
  permissions,
}: {
  counts: NavCounts;
  role: MembershipRole;
  permissions: PermissionMatrix | null | undefined;
}) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      (!item.beta || IS_BETA) &&
      (!item.roles || item.roles.includes(role)) &&
      (!item.permission || hasPermission(role, permissions, item.permission, "ver")),
  );
  let lastGroup = "";

  return (
    <nav className="primary-nav" aria-label="Navegação principal">
      {visibleItems.map((item) => {
        const showGroup = item.group !== lastGroup;
        lastGroup = item.group;
        const count = item.count ? counts[item.count] : undefined;
        const ativo = item.matches
          ? item.matches.some((prefixo) => pathMatches(pathname, prefixo))
          : pathname === item.href;
        return (
          <div key={item.href}>
            {showGroup && <span className="nav-label">{item.group}</span>}
            <Link
              href={item.href}
              className="nav-item"
              aria-current={ativo ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span className="nav-text">{item.label}</span>
              {count !== undefined && <span className="nav-badge">{count}</span>}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
