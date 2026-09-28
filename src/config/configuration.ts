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
  // metaLeadsPlanilhaToken: token estático conferido em POST
  // /integrations/meta-leads/planilha (Authorization: Bearer) — quem chama
  // é o script instalado na planilha do gestor de tráfego
  // (scripts/planilha-meta-leads.gs), canal por onde os leads do Meta
  // chegam hoje enquanto o webhook direto está parado. Mesmo molde do
  // cotacoesApiToken abaixo. Opcional: sem ele a rota responde 401.
  metaLeadsPlanilhaToken: process.env.META_LEADS_PLANILHA_TOKEN,
  // Integração com o app de cotações (gama-webapp, docs/integracao-cotacoes.md)
  // — token estático conferido nas rotas públicas de /integrations/cotacoes
  // (CotacoesService#assertTokenValido). Gerado pelo GAS (crm_config_instalar
  // no editor do Apps Script) e copiado pra cá. Opcional (não entra em
  // REQUIRED_VARS), mesmo raciocínio dos tokens eGestor/Meta: só essas rotas
  // usam, resto do app funciona sem isso configurado.
  cotacoesApiToken: process.env.COTACOES_API_TOKEN,
  // cotacoesDefaultOwnerUserId: Membership.userId (UUID de auth.users,
  // copiar de /dashboard/membros) que vira dono da oportunidade criada a
  // partir de um cartão do Trello pela tela do app de cotações. Opcional:
  // sem ela, a integração usa o dono do workspace — a oportunidade nunca
  // fica sem responsável (owner_user_id é NOT NULL), e o dono é
  // remanejável na tela do CRM depois.
  cotacoesDefaultOwnerUserId: process.env.COTACOES_DEFAULT_OWNER_USER_ID,
  // Caminho do Chromium usado pra virar a proposta em PDF (HtmlPdfService).
  // Vazio = usa o Chrome que o puppeteer baixa no `npm ci` do build, que é o
  // caso normal. A variável existe pro ambiente que já traz o chromium do
  // sistema (imagem própria, nixpacks com o pacote) e não quer o download.
  chromiumExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
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

  // Envio de e-mail (reports recorrentes, 2026-09-15). Opcional — mesmo
  // raciocínio dos tokens de integração acima: sem estas variáveis o CRM
  // sobe e funciona inteiro, só o report não sai (e o motivo fica no log
  // e na tabela report_log, nunca em silêncio). Só o backend usa.
  //
  // resendApiKey: chave da API do provedor de envio. SEGREDO — nunca em
  // web/, doc ou commit.
  resendApiKey: process.env.RESEND_API_KEY,
  // mailFrom: remetente, sempre um endereço no subdomínio de envio (é lá
  // que SPF/DKIM estão publicados). Formato "Nome <caixa@dominio>".
  mailFrom: process.env.MAIL_FROM,
  // mailReplyTo: caixa corporativa real que recebe as respostas — o
  // subdomínio de envio não tem caixa de entrada.
  mailReplyTo: process.env.MAIL_REPLY_TO,
  // reportTz: fuso usado tanto pelo agendador quanto pelo dia de
  // referência do report. O container roda em UTC; sem isto o "resumo das
  // 8h" sai às 5h e o "dia de hoje" vira o dia errado depois das 21h.
  reportTz: process.env.REPORT_TZ ?? 'America/Sao_Paulo',
  // reportCronPipeline: horário do resumo diário, em formato cron.
  // Padrão: 8h, de segunda a sexta.
  reportCronPipeline: process.env.REPORT_CRON_PIPELINE ?? '0 8 * * 1-5',
  // reportFollowupHorarios: horários (HH:MM, separados por vírgula) do
  // follow-up das cotações, em dias úteis. Lista vazia desliga o report.
  reportFollowupHorarios: (
    process.env.REPORT_FOLLOWUP_HORARIOS ?? '10:00,11:50,14:00,16:30'
  )
    .split(',')
    .map((h) => h.trim())
    .filter((h) => /^\d{1,2}:\d{2}$/.test(h)),
  // reportFollowupEtapas: quais etapas do Pipeline entram no follow-up
  // (nome exato da etapa, separado por vírgula; acento e maiúscula não
  // importam na comparação).
  reportFollowupEtapas: (
    process.env.REPORT_FOLLOWUP_ETAPAS ??
    'Solicitação de Propostas,Elaboração de Propostas,Aprovação de Propostas'
  )
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0),
  // reportCronConferencia: horário da conferência de falha silenciosa
  // (report que não saiu não gera reclamação — ver ReportSchedulerService).
  reportCronConferencia: process.env.REPORT_CRON_CONFERENCIA ?? '0 9 * * 1-5',
  // reportTo: lista fixa de destinatários separada por vírgula. Vazio (o
  // normal) = a lista sai do CRM: todo membro ativo que não é
  // representante e tem e-mail de contato cadastrado. Existe só como
  // válvula de escape pra teste ou pra incluir alguém de fora do CRM.
  reportTo: (process.env.REPORT_TO ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0),
  // reportAlertaTo: quem recebe o aviso de que o report do dia NÃO saiu.
  // Vazio = usa o primeiro destinatário da lista do dia.
  reportAlertaTo: (process.env.REPORT_ALERTA_TO ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0),
  // reportAppUrl: endereço do CRM usado no botão "Abrir o CRM" do e-mail.
  reportAppUrl: process.env.REPORT_APP_URL,
});
