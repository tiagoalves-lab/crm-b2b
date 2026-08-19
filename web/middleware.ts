import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Content-Security-Policy (docs/seguranca.md, decisão 5.3). Fica aqui, e
// não em next.config.ts, porque precisa de um nonce novo a cada
// requisição — é o nonce que permite proibir script inline genérico sem
// quebrar os scripts que o próprio Next.js injeta.
//
// Como o Next.js usa o nonce: quando ele encontra um `nonce-` no header
// Content-Security-Policy da REQUISIÇÃO, propaga esse valor
// automaticamente pra todas as tags <script> que gera. Por isso o header
// é setado nos dois lados (request e response), não só na resposta.
function buildCsp(nonce: string, isLocalDev: boolean): string {
  const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const directives = [
    `default-src 'self'`,

    // 'strict-dynamic' faz o navegador confiar no que os scripts com
    // nonce carregarem, e ignorar a allowlist de host — que é o modo
    // recomendado hoje. 'self' fica como fallback pra navegador antigo
    // que não entende strict-dynamic.
    // 'unsafe-eval' só em localhost: o Fast Refresh do Next usa eval em
    // desenvolvimento. Detectamos dev pelo hostname, e não por
    // NODE_ENV, de propósito — assim a regra "nenhuma env var sem
    // NEXT_PUBLIC_ em web/" continua valendo sem exceção, e uma variável
    // de ambiente mal configurada nunca consegue afrouxar a produção.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isLocalDev ? " 'unsafe-eval'" : ""}`,

    // 'unsafe-inline' em style é aceito conscientemente: o Next injeta
    // CSS inline no streaming de RSC e não há como nonce-ar tudo sem
    // quebrar. Risco de style inline é muito menor que o de script
    // inline — não executa código.
    `style-src 'self' 'unsafe-inline'`,

    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,

    // O navegador só fala com: a própria origem (Server Actions, rota
    // /api/cnpj) e o Supabase (login). Ele NUNCA chama o backend NestJS
    // direto — todo acesso à API passa por Server Component/Server
    // Action, do servidor da Vercel. Confirmado em 2026-08-12: nenhum
    // componente client importa `apiFetch`. Por isso a URL do Railway
    // não aparece aqui; se algum dia uma tela chamar a API do
    // navegador, vai falhar aqui e este comentário explica o porquê.
    `connect-src 'self' ${supabaseOrigin}${isLocalDev ? " ws: http://localhost:*" : ""}`.trim(),

    // Ninguém pode embutir o CRM num iframe (clickjacking), e o CRM não
    // embute ninguém.
    `frame-ancestors 'none'`,
    `frame-src 'none'`,

    // Impede que um script injetado reescreva a base das URLs relativas
    // ou aponte um <form> pra fora.
    `base-uri 'self'`,
    `form-action 'self'`,

    // Sem Flash/applet/embed — nada disso existe no projeto.
    `object-src 'none'`,
  ];

  // Em localhost o app roda em http; forçar upgrade quebraria o dev.
  if (!isLocalDev) directives.push(`upgrade-insecure-requests`);

  return directives.join("; ");
}

// Monta os headers da requisição que serão repassados ao Next, já com o
// nonce. Reconstruído a cada chamada (em vez de reaproveitado) porque o
// fluxo de cookies do Supabase abaixo muta `request.cookies` — capturar
// os headers uma vez só perderia o cookie de sessão renovado.
function requestHeadersWithNonce(
  request: NextRequest,
  nonce: string,
  csp: string,
): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  return headers;
}

export async function middleware(request: NextRequest) {
  const { hostname } = request.nextUrl;
  const isLocalDev = hostname === "localhost" || hostname === "127.0.0.1";
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce, isLocalDev);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeadersWithNonce(request, nonce, csp) },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeadersWithNonce(request, nonce, csp) },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Valida o token e renova a sessão a cada request — sem a renovação, a
  // sessão expira em Server Components mesmo com o usuário ativo.
  //
  // `getClaims()` e não `getUser()` (2026-08-13, ajuste de performance):
  // `getUser()` faz uma chamada de REDE ao servidor de auth do Supabase a
  // cada requisição pra validar o token. Como o matcher abaixo pega tudo
  // (páginas, payloads RSC e POSTs de Server Action), esse round-trip
  // entrava no caminho crítico de toda interação do CRM — clicar em
  // "Salvar" pagava a ida ao Supabase duas vezes (uma no POST da ação,
  // outra na navegação que vem depois).
  //
  // `getClaims()` mantém a verificação criptográfica da assinatura, mas
  // faz isso LOCALMENTE via WebCrypto, usando o JWKS público do projeto
  // em cache — verificado em 2026-08-13 que o projeto assina com ES256
  // (chave assimétrica), que é a condição pra validação local; com chave
  // simétrica a lib cairia de volta numa chamada de rede, ou seja, no
  // comportamento antigo, sem regressão de segurança. Também renova o
  // token quando está perto de expirar, igual `getUser()` fazia.
  //
  // Importante pro registro: este gate é de NAVEGAÇÃO (manda pro /login
  // quem não está logado). A autorização de verdade é do backend NestJS,
  // que revalida a assinatura do JWT contra o JWKS a cada chamada
  // (src/auth/supabase-auth.guard.ts, algoritmos restritos a ES256/RS256)
  // e aplica RLS + PolicyService por cima. Nenhum dado é servido com base
  // só no que este middleware decidiu.
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = typeof claimsData?.claims?.sub === "string";

  const isDashboardRoute = request.nextUrl.pathname.startsWith("/dashboard");
  if (isDashboardRoute && !isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("content-security-policy", csp);
    return redirect;
  }

  supabaseResponse.headers.set("content-security-policy", csp);
  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
