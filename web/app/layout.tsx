import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gama Brasil · CRM",
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
