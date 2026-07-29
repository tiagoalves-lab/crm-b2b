import { NextRequest, NextResponse } from "next/server";
import { getServerAccessToken } from "@/lib/api/auth";
import { lookupCnpj } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/client";

// Proxy same-origin pro backend — mantém o padrão do resto do projeto de
// nunca expor o access_token do Supabase ao JS do navegador (token só
// existe em Server Component/Server Action/Route Handler, todos
// server-side). O client component do form de Empresa chama esta rota,
// não o backend direto.
export async function GET(request: NextRequest) {
  const cnpj = request.nextUrl.searchParams.get("cnpj");
  if (!cnpj) {
    return NextResponse.json({ message: "cnpj é obrigatório." }, { status: 400 });
  }

  const token = await getServerAccessToken();

  try {
    const result = await lookupCnpj(token, cnpj);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Erro inesperado ao consultar CNPJ." },
      { status: 500 },
    );
  }
}
