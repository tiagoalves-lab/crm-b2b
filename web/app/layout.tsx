import type { Metadata } from "next";
import "./globals.css";
import { IS_BETA } from "@/lib/ambiente";

export const metadata: Metadata = {
  title: IS_BETA ? "BETA · Gama Brasil · CRM" : "Gama Brasil · CRM",
  description: "CRM B2B multi-tenant — Gama Brasil",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
