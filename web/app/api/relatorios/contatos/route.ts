import { NextRequest, NextResponse } from "next/server";
import { getServerAccessToken } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { listMemberships } from "@/lib/api/memberships";
import { gerarRelatorioContatos } from "@/lib/api/relatorios";
import { dayKeyBR } from "@/lib/format-date";
import {
  COLUNAS_CONTATOS,
  filtroContatos,
  lerParamsContatos,
  linhaContato,
} from "@/app/dashboard/relatorios/contatos";

// Download do relatório "Contatos" em CSV (2026-09-28). Rota do próprio
// Next, e não link direto pro backend, pelo mesmo motivo de /api/cnpj: o
// token do Supabase só existe no servidor. Visibilidade é a do backend —
// esta rota só formata o que ele devolveu.
//
// Formato pensado pro Excel em português: separador ";" (a vírgula é o
// separador decimal no Brasil) e BOM UTF-8 (sem ele o Excel abre os
// acentos quebrados).
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const token = await getServerAccessToken();

  try {
    const [relatorio, memberships] = await Promise.all([
      gerarRelatorioContatos(token, filtroContatos(lerParamsContatos(params))),
      listMemberships(token),
    ]);

    const linhas = [
      [...COLUNAS_CONTATOS],
      ...relatorio.rows.map((row) => linhaContato(row, memberships)),
    ];
    const csv = "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contatos-${dayKeyBR(new Date())}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Erro inesperado ao gerar o CSV." }, { status: 500 });
  }
}

function celula(valor: string): string {
  // Texto que começa com = + - @ vira fórmula quando o Excel abre o
  // arquivo (injeção de fórmula). O apóstrofo na frente faz o Excel
  // tratar como texto puro.
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}
