export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  // Opcional (não entra em REQUIRED_VARS): só é exigida quando o upload
  // de anexos é de fato usado (SupabaseStorageService), não no boot da
  // aplicação — mesmo raciocínio de não travar o resto do app por uma
  // feature que pode ainda não estar configurada em todo ambiente.
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Integração eGestor (docs/roadmap.md) — personal_token
  // de cada uma das duas contas eGestor da Gama. Opcional (não entra em
  // REQUIRED_VARS), mesmo raciocínio de supabaseServiceRoleKey: só o
  // módulo de sync usa, resto do app funciona sem isso configurado.
  egestorApiTokenMatriz: process.env.EGESTOR_API_TOKEN_MATRIZ,
  egestorApiTokenFilial: process.env.EGESTOR_API_TOKEN_FILIAL,
  // Webhook eGestor (docs/webhook-egestor.md) — securityToken que cada
  // conta devolve no cadastro (POST /webhooks), usado pra autenticar o
  // payload recebido em POST /integrations/egestor/webhook/:estabelecimento.
  // Opcional, mesmo raciocínio: só a rota do webhook usa.
  egestorWebhookSecurityTokenMatriz:
    process.env.EGESTOR_WEBHOOK_SECURITY_TOKEN_MATRIZ,
  egestorWebhookSecurityTokenFilial:
    process.env.EGESTOR_WEBHOOK_SECURITY_TOKEN_FILIAL,
  // Central de Leads do Meta (docs/roadmap.md, docs/webhook-meta-leads.md)
  // — App próprio no Meta for Developers. Opcional (não entra em
  // REQUIRED_VARS), mesmo raciocínio dos tokens eGestor: só a rota do
  // webhook usa, resto do app funciona sem isso configurado.
  //
  // metaAppSecret: App Secret do App no Meta for Developers, usado pra
  // conferir a assinatura HMAC (X-Hub-Signature-256) de cada evento
  // recebido — equivalente ao securityToken do webhook eGestor.
  metaAppSecret: process.env.META_APP_SECRET,
  // metaPageAccessToken: token de acesso da Página vinculada ao App, usado
  // pra buscar os campos do lead (GET /{leadgen_id}) depois do webhook
  // avisar só o id.
  metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN,
  // metaVerifyToken: valor arbitrário escolhido na hora de cadastrar a
  // assinatura do webhook no Meta for Developers — confirmado de volta no
  // handshake `hub.challenge` (GET) antes da Meta aceitar a URL.
  metaVerifyToken: process.env.META_VERIFY_TOKEN,
  // metaLeadsDefaultOwnerUserId: Membership.userId (não e-mail — RawLead/
  // Company.ownerUserId são plain UUID de auth.users, não há round-trip ao
  // Supabase Admin API neste fluxo) do gerente que recebe todo lead
  // capturado pela Central de Leads (decisão do usuário, 2026-08-14: "vira
  // gerente" — ver docs/roadmap.md decisão 1.2/1.3). Copiar o id de
  // `/dashboard/membros`.
  metaLeadsDefaultOwnerUserId: process.env.META_LEADS_DEFAULT_OWNER_USER_ID,
  // Integração com o app de cotações (gama-webapp, docs/integracao-cotacoes.md)
  // — token estático conferido nas rotas públicas de /integrations/cotacoes
  // (CotacoesService#assertTokenValido). Gerado pelo GAS (crm_config_instalar
  // no editor do Apps Script) e copiado pra cá. Opcional (não entra em
  // REQUIRED_VARS), mesmo raciocínio dos tokens eGestor/Meta: só essas rotas
  // usam, resto do app funciona sem isso configurado.
  cotacoesApiToken: process.env.COTACOES_API_TOKEN,
  // Aceita uma ou mais origens separadas por vírgula (ex.: URL da Vercel +
  // domínio próprio coexistindo, caso 2026-08-06 — crm.gamabrasil.com.br
  // adicionado ao lado de web-gamma-olive-80.vercel.app) — sem isso,
  // trocar/adicionar domínio de produção exigiria descartar o anterior.
  frontendOrigin: (
    process.env.FRONTEND_ORIGIN ??
    (process.env.NODE_ENV === 'production'
      ? undefined
      : 'http://localhost:3000')
  )
    ?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
});
