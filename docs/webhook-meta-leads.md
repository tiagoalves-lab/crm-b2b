# Central de Leads do Meta — webhook `leadgen` e planilha

Como o CRM recebe automaticamente os leads que caem na Central de Leads
do Meta Business Suite (formulários de Lead Ads no Facebook/Instagram do
Portfólio da Gama). Módulo `src/integrations/meta-leads/`, com **dois
canais** que desembocam na mesma esteira:

- **Webhook direto da Meta** (implementado em 2026-08-14) — parado
  enquanto o App não sai do modo desenvolvimento (ver "O que falta").
- **Planilha do gestor de tráfego** (em uso desde 2026-09-04) — o canal
  por onde os leads reais chegam hoje. Seção própria logo abaixo.

Mesma natureza do `webhook-egestor.md`: é **push** — alguém chama uma URL
do CRM quando um lead novo aparece, em vez de o CRM ficar consultando. A
diferença estrutural pro eGestor é que aqui o fluxo é de **mão única**: a
Central de Leads (e a planilha) é fonte, nunca destino. O CRM nunca
escreve de volta — por isso este módulo não tem nada equivalente ao
mecanismo de eco (`EgestorWriteEcho`), que só existe lá porque a escrita
do próprio CRM dispara webhook de volta.

## Canal em uso hoje: planilha do gestor de tráfego

O gestor de tráfego (conta externa à Gama) mantém a planilha Google
Sheets **"LEADS GAMA BRASIL"** com o export da Central de Leads. O
usuário espelha a aba **"Query CRM"** dela (que consolida as linhas de
todas as versões do formulário) numa planilha **própria, "LEADS GAMA
DB"**, via `IMPORTRANGE` — só ele tem acesso a essa, e é dela que o CRM
lê (decisão do usuário, 2026-09-04: o script e o token não ficam numa
planilha de terceiro). O `IMPORTRANGE` atualiza em até ~30 minutos, então
é essa a latência máxima de um lead novo.

**Como funciona**

1. Um Google Apps Script (`scripts/planilha-meta-leads.gs`), instalado
   na planilha "LEADS GAMA DB" (Extensões → Apps Script) na conta do
   usuário, roda quando a planilha muda e, por garantia, a cada 5
   minutos. Ele nunca escreve na planilha.
2. O script manda as linhas novas (lotes de 50) pra
   `POST /integrations/meta-leads/planilha`, com o token
   `META_LEADS_PLANILHA_TOKEN` em `Authorization: Bearer …`. Cada linha
   vai como `{ id, campos: { cabeçalho: valor } }` — quem interpreta as
   colunas é o CRM (`MetaLeadsPlanilhaService`), então coluna nova na
   planilha não exige mexer no script.
3. O CRM confere o token **antes** de gravar qualquer coisa, registra a
   linha em `meta_leads_webhook_events` (`origem = 'planilha'`, dedupe
   pelo id que a Meta dá ao lead — mesma chave do webhook direto) e
   entra na fase 3 do `MetaLeadsWebhookService` (`criarLeadNoCrm`): a
   mesma do webhook, sem a chamada à Graph API porque as respostas já
   vêm na linha.
4. Lead de teste da Meta (botão "Testar" do formulário: e-mail
   `test@meta.com`, campos `<test lead: …>`) é filtrado no script **e**
   no CRM — fica registrado como `lead_de_teste_ignorado`, nunca vira
   linha na Prospecção.

**O que cada linha vira no CRM**

- `RawLead` na Prospecção, `fonte = meta_leads`, tag **"Meta Business"**,
  na carteira do gerente (`META_LEADS_DEFAULT_OWNER_USER_ID`), com o
  score calculado pela fórmula de sempre.
- `Contact` da pessoa que preencheu (nome + telefone/e-mail).
- **Anotação na Timeline** do lead com a origem (plataforma, formulário,
  campanha, anúncio) e as perguntas próprias do formulário — hoje:
  equipamento procurado, prazo de compra, se já usa máquina do tipo.
- CNPJ: o formulário atual pergunta (`qual_o_cnpj_da_sua_empresa?`).
  Quando a pessoa preenche, entra direto e o dedupe por CNPJ funciona;
  quando vem vazio, o vendedor preenche na aba "Dados cadastrais" da
  ficha (`PATCH /raw-leads/:id/cadastro`, que consulta a Receita e
  completa razão social, CNAE, porte, situação e cidade/UF). **Aprovar
  para Lead exige CNPJ** — ver regras de negócio, 3.4.

**Diretrizes (usuário, 2026-09-04)**

- A planilha é **só porta de entrada**. O CRM copia a linha na chegada
  e, dali em diante, a ficha vive no CRM. Alteração ou exclusão
  posterior na planilha não muda nada no CRM; correção se faz na ficha.
- Cada lead entra **uma única vez**. Reenviar a planilha inteira
  (`crm_reenviar_tudo` no script) é seguro — o CRM ignora o que já tem.
- O nome da aba ("Query CRM") e os nomes das colunas são o **contrato**
  com o gestor de tráfego. Se ele renomear, o envio para
  (`crm_status` no script mostra "aba não encontrada") ou um campo deixa
  de ser reconhecido (vira pergunta na anotação, nada se perde).

**Instalação e operação do script** — instruções no cabeçalho do próprio
`scripts/planilha-meta-leads.gs`: colar em Extensões → Apps Script da
"LEADS GAMA DB", rodar `crm_instalar` (autorizar na primeira vez). **O
token nunca fica no código**: o próprio script gera um na instalação,
guarda nas Propriedades do script e mostra no registro de execução pra
copiar pro Railway (`META_LEADS_PLANILHA_TOKEN`) — mesmo molde do
`crm_config_instalar` da integração de cotações. `crm_status` mostra
gatilhos, último envio e último erro; `crm_mostrar_token` repete o token;
`crm_gerar_novo_token` rotaciona (trocar no Railway depois);
`crm_desinstalar` para tudo.

Erro conhecido na primeira autorização: "Acesso bloqueado: erro de
autorização — The OAuth client is not fully created yet (401
invalid_client)". É o Google ainda propagando o projeto recém-criado, não
bloqueio da conta: esperar alguns minutos, recarregar o editor e rodar de
novo.

**Segurança da planilha (pendência com o gestor de tráfego)**: em
2026-09-04 ela estava compartilhada como "qualquer pessoa com o link pode
editar" — dado pessoal de lead exposto e editável por quem tiver o link.
Pedir restrição a pessoas nomeadas. Não afeta o script (roda na conta do
usuário).

## Decisões fechadas

**Abordagem: Graph API direta, não middleware no-code**
- Decisão → Graph API direta (App próprio no Meta for Developers), não
  middleware no-code (Zapier/Make). Fica tudo dentro do backend NestJS,
  mesmo padrão do webhook eGestor já em produção, sem dependência paga
  nova e sem perder observabilidade do fluxo.
- Fonte → Decisão do usuário, perguntada direto (2026-08-14).

**Dono do lead: sempre um gerente**
- Decisão → o lead que chega pela Central de Leads nasce com
  `ownerUserId` de um **gerente** — não nasce sem dono (pra ser
  reivindicado como os de planilha), nem entra em rodízio automático
  entre operadores. O gerente distribui a partir daí.
- Fonte → Decisão do usuário, perguntada direto (2026-08-14).

**Qual gerente: fixo, por variável de ambiente**
- Decisão → qual gerente vem de `META_LEADS_DEFAULT_OWNER_USER_ID` (um
  só, fixo). É o `Membership.userId` — UUID de `auth.users`, copiado de
  `/dashboard/membros` — e não um e-mail: `RawLead.ownerUserId` e
  `Company.ownerUserId` são UUID puro, e resolver e-mail→UUID exigiria
  round-trip ao Supabase Admin API dentro do caminho do webhook, que tem
  janela curta de resposta.
- Fonte → decorrência da decisão acima, escolhida na implementação (o usuário só
  fechou "vira gerente", não qual) — trocar por outra regra (rodízio,
  gerente por Página) é ajuste pequeno e isolado em
  `MetaLeadsWebhookService#resolverOwner`.

**Sem tabela nova pro lead: entra na esteira de staging que já existe**
- Decisão → o lead do Meta entra na MESMA esteira de staging dos leads
  de planilha/crawler (`raw_leads` via `RawLeadService#create`), sem
  tabela nova pro lead em si — reaproveita scoring automático,
  classificação quente/morno/frio, normalização em caixa alta e o fluxo
  de "Aprovar para Lead" já prontos. A única tabela nova é
  `meta_leads_webhook_events`, que é log de evento, não de lead.
- Fonte → plano original do roadmap, confirmado na implementação.

**Quem preencheu o formulário vira contato da empresa**
- Decisão → a pessoa que preencheu o formulário vira um `Contact` da
  company-lead, quando dá pra identificá-la (tem nome **e** ao menos
  e-mail ou telefone). Mesmo padrão do import de planilha com contatos.
- Fonte → decorrência do modelo de dados (a empresa é a `Company`, a
  pessoa é o `Contact`) — sem isso, nome e telefone de quem preencheu
  ficariam só como campo solto da empresa.

**Formulário "Orçamento | Máquinas Industriais Gama" (levantado na
planilha, 2026-09-04)**
- Decisão → o DE-PARA (`meta-lead-mapper.ts`) cobre os campos padrão
  (`full_name`, `email`, `phone_number`, `city`, `company_name`) e a
  pergunta de CNPJ (`qual_o_cnpj_da_sua_empresa?`, ou qualquer campo
  cujo nome contenha "cnpj"). As três perguntas próprias do formulário
  (equipamento procurado, prazo de compra, se já usa máquina do tipo)
  não viram coluna — viram anotação (decisão abaixo).
- Fonte → colunas da aba "Query CRM" da planilha do gestor de tráfego.

**Pergunta própria do formulário vira anotação na Timeline**
- Decisão → toda pergunta que o DE-PARA não conhece entra, com a
  resposta, numa anotação na Timeline do lead (tipo "Anotação", igual à
  registrada à mão), junto com a origem (plataforma, formulário,
  campanha, anúncio). A Meta troca espaço por `_` na pergunta e nas
  opções de múltipla escolha; o CRM desfaz isso na anotação. O dado cru
  continua em `meta_leads_webhook_events.lead_payload`.
- Fonte → Decisão do usuário, 2026-09-04 ("essas informações constem
  como anotação").

**Tag "Meta Business"**
- Decisão → todo lead vindo do Meta (webhook ou planilha) recebe a tag
  `Meta Business` na Prospecção, escrita exatamente assim. É por ela que
  a lista filtra; `fonte = meta_leads` continua distinguindo no banco.
- Fonte → Decisão do usuário, 2026-09-04.

## Como o fluxo funciona

1. Alguém preenche um formulário de Lead Ads no Facebook/Instagram.
2. A Meta chama `POST /integrations/meta-leads/webhook` no CRM. **O
   payload não traz as respostas** — só identificadores (`leadgen_id`,
   `page_id`, `form_id`, `ad_id`).
3. O CRM confere a assinatura HMAC do corpo (ver "Segurança" abaixo)
   **antes de gravar qualquer coisa**.
4. Registra o evento cru em `meta_leads_webhook_events` (dedupe por
   `leadgen_id`).
5. Busca as respostas de verdade: `GET /{leadgen_id}` na Graph API
   (`MetaGraphService`), autenticado com o token da Página.
6. Mapeia os campos (`meta-lead-mapper.ts`) e cria o `RawLead` +
   `Company` (via `RawLeadService#create`, que já normaliza caixa alta,
   calcula score e dedupe por CNPJ) + `Contact` da pessoa, na carteira
   do gerente configurado.
7. Marca o evento como processado.

### Payload recebido

```json
{
  "object": "page",
  "entry": [
    {
      "id": "<PAGE_ID>",
      "time": 1700000000,
      "changes": [
        {
          "field": "leadgen",
          "value": {
            "leadgen_id": "444444444444",
            "page_id": "444444444444",
            "form_id": "444444444444",
            "ad_id": "444444444",
            "created_time": 1700000000
          }
        }
      ]
    }
  ]
}
```

Um POST pode trazer **várias** `entry` e várias `changes` (a Meta agrupa
eventos que chegam quase juntos) — o handler achata tudo e processa lead
a lead. `created_time` é epoch em **segundos**, não milissegundos.

Repare que os ids vêm como **número**, sem aspas. O handler converte tudo
pra string (id de negócio nunca vira aritmética); ids do Facebook têm
~15-16 dígitos, dentro do limite de inteiro seguro do JavaScript, então
`JSON.parse` não perde precisão hoje.

> Estrutura acima **conferida contra a doc oficial da Meta em
> 2026-08-14** (páginas "Retrieving Leads" e "Webhooks for Lead Ads"),
> não escrita de memória.

### Resposta do `GET /{leadgen_id}`

```json
{
  "id": "<LEAD_ID>",
  "created_time": "2026-08-14T12:00:00+0000",
  "ad_id": "...",
  "form_id": "...",
  "field_data": [
    { "name": "full_name", "values": ["Fulano de Tal"] },
    { "name": "email", "values": ["fulano@exemplo.com.br"] },
    { "name": "phone_number", "values": ["+5511900000000"] }
  ]
}
```

O `name` de cada campo depende de como o formulário foi montado: campos
padrão têm nome fixo (`full_name`, `email`, `phone_number`,
`company_name`, `job_title`, `city`, `state`…), e **pergunta customizada
vem com o texto da pergunta como chave** — literalmente `"Qual produto te
interessa?"`. Confirmado na doc oficial (2026-08-14); é por isso que o
mapeador indexa as respostas em minúsculas e reporta como "não mapeado"
tudo que não bate com um alias conhecido, em vez de tentar adivinhar.

A Meta também permite pré-preencher endereço, CEP, país, data de
nascimento, gênero e estado civil. Ficam **fora** do DE-PARA de
propósito: não há campo correspondente em `RawLead`/`Company`, e criar
mapeamento pra dado que ninguém pediu só produziria coluna errada. Tudo
continua em `lead_payload`.

## Segurança

Rota **pública** (`@Public()`, sem JWT do Supabase — quem chama é a
Meta, não um usuário logado). O que substitui o login:

- **`POST`**: assinatura `X-Hub-Signature-256` — HMAC-SHA256 do corpo
  **cru** com o `META_APP_SECRET`, comparado em tempo constante. Tem que
  ser dos bytes exatos recebidos, por isso `main.ts` sobe a app com
  `rawBody: true`: recalcular o HMAC a partir do JSON já parseado daria
  digest diferente a qualquer variação de espaçamento/ordem de chaves.
- **`GET`**: handshake de verificação — a Meta só aceita a URL se
  receber o `hub.challenge` de volta cru (`text/plain`), e o CRM só
  devolve se o `hub.verify_token` bater com `META_VERIFY_TOKEN`
  (também em tempo constante).

Ambos os controles têm teste provando que funcionam, em
`test/idor.e2e-spec.ts` (bloco "rota pública (webhook do Meta)"), onde a
rota também está declarada em `ROTAS_PUBLICAS`. Os testes conferem a
**mensagem** da recusa, não só o 401: sem isso passariam verde mesmo se
o motivo real fosse "segredo não configurado" em vez de "assinatura
inválida" — 401 pelo motivo errado é teste que não prova nada.

Nenhum segredo é persistido: o `rawPayload` gravado é só o `value` da
mudança (identificadores, sem token nenhum), e o token da Página vai no
header `Authorization` da chamada à Graph API, nunca na query string
(URL completa aparece em log de proxy; header não).

Tabela nova `meta_leads_webhook_events` com RLS workspace-scoped na
**mesma migration** que a cria (`20260814100000_meta_leads_webhook_events`),
mesmo padrão de `egestor_webhook_events`.

## Erro e retry

Erro em qualquer fase **propaga** e vira 500 — de propósito, é o que faz
a Meta reenviar o evento. Mesma disciplina "sem fila/cron" já testada no
webhook eGestor: o evento fica com `processed_at` nulo até dar certo, e o
reenvio o reprocessa. Evento já com `processed_at` preenchido encerra na
hora, sem gastar chamada da Graph API.

**Política de retry da Meta** (doc oficial, conferida em 2026-08-14): uma
tentativa imediata, depois novas tentativas com frequência decrescente ao
longo de **36 horas**; passado esse prazo o evento é descartado de vez. A
doc é explícita em que a **deduplicação é responsabilidade de quem
recebe** — é o índice único `(workspace_id, leadgen_id)` que cumpre isso
aqui.

Consequência prática pro nosso desenho: 36h é a janela em que uma falha
transitória (Railway fora do ar, Graph API instável) se resolve sozinha.
Uma indisponibilidade maior que isso perde lead sem aviso — por isso o
caminho `owner_nao_configurado` responde **200** em vez de 500: um erro de
configuração não se resolve com retry, e insistir só gastaria a janela até
o evento ser descartado com o dado perdido. Respondendo 200 e guardando o
`lead_payload`, o lead fica recuperável indefinidamente pelo banco.

Exceção deliberada: se `META_LEADS_DEFAULT_OWNER_USER_ID` não estiver
configurado (ou não apontar pra um membro **ativo**), o CRM **busca e
grava o payload do lead** em `lead_payload`, responde 200 e deixa o
evento pendente (`processed_at` nulo, `process_result =
'owner_nao_configurado'`). Falhar com 500 aqui só geraria retry infinito
por um problema de configuração que retry nenhum resolve — e responder
200 sem guardar o payload perderia o lead de vez, já que a Meta não
guarda leads pra sempre.

> **Follow-up conhecido**: não existe ainda endpoint/botão pra reprocessar
> os eventos
> que ficaram pendentes. Enquanto não existir, o caminho é um script
> ad-hoc lendo `meta_leads_webhook_events` com `processed_at IS NULL`.
>
> Consequência prática na hora de ligar a integração: **configure as
> variáveis no Railway ANTES de assinar o campo `leadgen` na Página.**
> Na ordem inversa, todo lead que chegar na janela entre uma coisa e
> outra fica salvo no banco mas não vira `RawLead` sozinho — nada se
> perde, mas alguém precisa rodar o script depois pra recuperar.

## Variáveis de ambiente

Só no backend (Railway), **nunca** em `web/` — ver `docs/seguranca.md`.
Nomes em `.env.example`, valores nunca em commit/doc/chat.

- `META_APP_SECRET` — App Secret do App (Meta for Developers →
  Configurações → Básico). Valida a assinatura de todo evento.
- `META_PAGE_ACCESS_TOKEN` — token de acesso da Página vinculada ao App.
  Usado no `GET /{leadgen_id}`.
- `META_VERIFY_TOKEN` — valor arbitrário escolhido por nós no cadastro
  da assinatura; a Meta devolve no handshake.
- `META_LEADS_DEFAULT_OWNER_USER_ID` — `Membership.userId` do gerente
  dono dos leads (a decisão sobre qual gerente). Vale pros dois canais.
- `META_LEADS_PLANILHA_TOKEN` — token estático do canal da planilha
  (`Authorization: Bearer …` em `POST /integrations/meta-leads/planilha`).
  Gerado pelo script na instalação (`crm_instalar`) e copiado pra cá;
  vive nas Propriedades do script e no Railway, nunca em código.

Todas opcionais no boot (não entram em `REQUIRED_VARS`) — sem elas só a
ingestão do Meta não funciona, o resto do app roda normal.

## Estado da configuração

**Ligada em 2026-08-20.** O que está no ar:

- App **Integrador de Leads** (id `1216494030654783`), tipo Empresa,
  vinculado ao Portfólio "Gama Manufatura Avançada". Existe um segundo
  App de mesmo nome, sobra de uma criação duplicada, sem vínculo com o
  Portfólio e sem uso.
- Webhook do objeto **Page** apontando pra
  `/integrations/meta-leads/webhook` no Railway, campo `leadgen`
  assinado.
- Página **Gama Manufatura Avançada** (id `268499809678438`) instalada no
  App via `POST /{page-id}/subscribed_apps` com
  `subscribed_fields=leadgen`. **Esse passo é separado** da assinatura no
  painel do App: sem ele o webhook fica configurado e não chega nada.
- As quatro variáveis de ambiente configuradas no Railway.
- Migration aplicada e handshake de verificação respondendo.

### Como o token foi obtido — e por que não pelo Explorador da Graph API

O App é do tipo **Empresa**. Nesse tipo a Meta usa o Facebook Login for
Business, que exige uma configuração de login própria — o token de
usuário gerado no Explorador da Graph API sai válido, com todas as
permissões concedidas, e mesmo assim enxergando **zero Páginas**. Foi
exatamente o que aconteceu aqui, duas vezes, até a causa ficar clara.
Conferido na doc oficial (2026-08-20).

O caminho que funciona é **usuário do sistema**, em Business Settings →
Usuários → Usuários do sistema:

1. Criar o usuário do sistema com função **Employee**, não Admin. Ele só
   precisa dos dois ativos abaixo; Admin daria acesso a todo o Portfólio
   e ainda permitiria criar outros usuários do sistema.
2. Atribuir a ele a **Página** (acesso total) e o **App**.
3. Gerar token com expiração **Nunca** e as seis permissões da lista
   acima.
4. Derivar daí o token da Página (`GET /me/accounts`) — **é esse** que vai
   em `META_PAGE_ACCESS_TOKEN`. Token de Página derivado de usuário do
   sistema não expira.

Vantagem sobre o token pessoal, além de não expirar: não quebra quando a
pessoa que autorizou sai da empresa.

## Teste ponta a ponta — feito pela metade (2026-08-21)

O caminho **dentro do CRM está provado**. Um lead de teste criado por
`POST /{form-id}/test_leads` foi processado com sucesso: assinatura HMAC
validada, evento gravado, `GET /{leadgen_id}` na Graph API trazendo as
respostas reais, e `RawLead` + `Contact` criados na carteira do gerente
(`process_result = 'raw_lead_e_contato_criados'`, visível na tela de
Prospecção).

O que **não** foi provado é a entrega automática: a Meta nunca chamou o
webhook. A entrega teve que ser simulada por fora, assinando o payload com
o `META_APP_SECRET` e postando na URL de produção.

**Causa, confirmada na doc oficial (2026-08-21):** App em **modo
desenvolvimento** não recebe dado de produção — só o disparo do botão
"Testar" do painel. Com anúncio no ar, o lead ficaria parado na Central de
Leads.

A configuração da Meta em si está correta e foi conferida por API: a
assinatura do App aponta pro objeto `page`, ativa, com a URL certa e o
campo `leadgen@v26.0`; e a Página está com o App instalado.

Ao retomar, lembrar que a Meta permite **um** lead de teste por formulário
e o nosso já foi consumido (`leadgen_id` 2463292117488309). Pra repetir o
teste é preciso apagar o lead de teste antes, ou usar um lead real.

## O que falta

0. **O App está com o acesso à API bloqueado (conferido 2026-08-31).**
   Qualquer chamada à Graph API com as credenciais do App — token da
   Página ou app access token — volta `"API access blocked"`
   (`OAuthException`, code 200). Não é rede nem token expirado: a mesma
   Graph API responde normalmente a chamadas sem credencial, com erro
   diferente. É restrição no App em si, provavelmente decorrente das
   pendências abaixo (política de privacidade e categoria vazias).
   Conferir o aviso no painel do App antes de qualquer outra tentativa —
   enquanto isso não sair, nem o webhook nem a busca das respostas do
   lead funcionam.
1. **Publicar a Política de Privacidade — é o bloqueio atual.** Virar a
   chave "Ao vivo" falha com "URL da Política de Privacidade inválido";
   sem ela o App não sai do modo desenvolvimento. O site da Gama
   (`gamabrasil.com.br`) roda WordPress e **não tem** essa página hoje —
   nem link no rodapé. **Texto final pronto em 2026-08-31**, em duas
   versões na Área de Trabalho do usuário
   (`politica-de-privacidade-gama.html`, pra colar como bloco HTML, e
   `politica-de-privacidade-gama-TEXTO.txt`): controladora, CNPJ e
   endereço preenchidos com a matriz, cookies/transferência
   internacional/prazos fechados. Sobra confirmar o canal de privacidade
   (`privacidade@gamabrasil.com.br` precisa existir ou redirecionar) e o
   encarregado. Falta identificar quem tem acesso de administrador do
   WordPress e publicar.
2. **Categoria do App.** Também está vazia nas configurações básicas, ao
   lado de política de privacidade e termos de uso. Provável segunda
   exigência da mesma tela.
3. **Acesso avançado / App Review.** O próprio painel avisa que, além de
   publicar o App, dados de usuário final podem exigir permissões em
   acesso avançado. Só dá pra confirmar depois de virar a chave.
4. **Qualidade do lead — resolvido pelo lado do marketing (2026-09-04).**
   O formulário atual pede nome, e-mail, telefone, cidade, empresa e
   CNPJ, mais as três perguntas de qualificação. Quando o CNPJ vem
   vazio, o vendedor completa na ficha (ver "Canal em uso hoje").
