import type { NextConfig } from "next";
import path from "node:path";

// Cabeçalhos de segurança que não dependem de nada por requisição
// (docs/seguranca.md, decisão 5.3). A CSP NÃO está aqui: ela precisa de
// um nonce novo a cada requisição, então é montada em middleware.ts.
//
// Estes ficam neste arquivo, e não no middleware, porque o matcher do
// middleware não cobre `_next/static` — e queremos `nosniff` valendo
// também pros arquivos estáticos.
const securityHeaders = [
  // Impede o navegador de "adivinhar" o tipo de um arquivo e executá-lo
  // como script quando ele não é.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Bloqueia o CRM de ser carregado dentro de um iframe de terceiro
  // (clickjacking). A CSP em middleware.ts repete isso via
  // `frame-ancestors`, que é o mecanismo moderno; este aqui cobre
  // navegador antigo que ignora frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },

  // Não vaza a URL interna (que contém id de empresa/lead) no Referer ao
  // navegar pra fora do domínio.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // O CRM não usa câmera, microfone nem localização — negar
  // explicitamente evita que um script injetado peça acesso.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },

  // 2 anos, incluindo subdomínios. `preload` ficou DE FORA de propósito:
  // entrar na lista de preload dos navegadores é praticamente
  // irreversível e valeria pro domínio da empresa inteiro — decisão de
  // infra que não cabe a um ajuste de código tomar sozinho.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Evita o aviso de "múltiplos lockfiles" — o NestJS na raiz do repo tem o
  // seu próprio package-lock.json, mas o workspace deste app é só `web/`.
  outputFileTracingRoot: path.join(__dirname),

  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

export default nextConfig;
