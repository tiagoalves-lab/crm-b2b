# Central de Leads do Meta — webhook `leadgen`

Como o CRM recebe automaticamente os leads que caem na Central de Leads
do Meta Business Suite (formulários de Lead Ads no Facebook/Instagram do
Portfólio da Gama). Implementado em 2026-08-14, módulo
`src/integrations/meta-leads/`.

Mesma natureza do `webhook-egestor.md`: é **push** — a Meta chama uma URL
do CRM quando alguém preenche um formulário, em vez de o CRM ficar
consultando. A diferença estrutural pro eGestor é que aqui o fluxo é de
**mão única**: a Central de Leads é fonte, nunca destino. O CRM nunca
escreve de volta na Meta — por isso este módulo não tem nada equivalente
ao mecanismo de eco (`EgestorWriteEcho`), que só existe lá porque a
escrita do próprio CRM dispara webhook de volta.

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

❓ **DÚVIDA — quais formulários e quais campos**: falta levantar
quais formulários de Lead Ads a Gama roda hoje e o que cada um pergunta.
Sem isso o DE-PARA (`meta-lead-mapper.ts`) cobre só os **campos padrão**
da Meta — `full_name`/`first_name`+`last_name`, `email`, `phone_number`,
`company_name`, `city`, `state`, `cnpj`, com os aliases mais comuns de
cada um. Pergunta customizada ("Qual produto te interessa?") **não se
perde**: a resposta inteira do `GET /{leadgen_id}` é gravada em
`meta_leads_webhook_events.lead_payload`, e o nome do campo não
reconhecido sai no log da aplicação. O que ainda não existe é ela
aparecer em alguma tela — decidir isso depois de ver os formulários
reais.

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
  dono dos leads (a decisão sobre qual gerente).

Todas opcionais no boot (não entram em `REQUIRED_VARS`) — sem elas só a
ingestão do Meta não funciona, o resto do app roda normal.

## O que falta pra ligar em produção

**Estado em 2026-08-17.** Já feito e conferido contra produção:

- Migration aplicada no banco real (`meta_leads_webhook_events` existe,
  com RLS ativa).
- Rota no ar no Railway — o handshake de verificação (`GET`) responde o
  `hub.challenge` corretamente, testado de fora.
- `META_VERIFY_TOKEN` gerado e gravado no Railway (valor só no painel,
  nunca em commit/chat).
- `META_LEADS_DEFAULT_OWNER_USER_ID` gravado — aponta pro único
  `manager` ativo do workspace.

Faltam só `META_APP_SECRET` e `META_PAGE_ACCESS_TOKEN`, que só existem
depois do App criado.

**Bloqueio atual: o cadastro do usuário no Meta for Developers.** O
registro trava na etapa "Verify account" — o SMS com o código nunca
chega. Já tentado: reenvio, conferência do número na Central de Contas
(está completo e bem formado), e troca de número. A troca de número
esbarrou no limite antispam do próprio Meta ("Convém ir com mais calma
ou parar um pouco para evitar uma restrição na sua conta"), então a
tentativa foi interrompida de propósito em 2026-08-17 — insistir arrisca
restrição na conta pessoal.

Caminhos ainda não tentados, pra retomar: refazer o cadastro pelo
navegador do celular (o Meta às vezes confirma pelo app, sem SMS);
adicionar uma segunda linha na Central de Contas em vez de trocar a
existente; ou verificar a conta por cartão, alternativa que o Meta
aceita no lugar do SMS.

Sequência completa, nesta ordem — os dois primeiros passos são **ação do
usuário**, não dá pra automatizar de uma sessão de código:

1. **Criar o App no Meta for Developers** vinculado ao Business
   Portfolio da Gama, com o produto "Webhooks" e as permissões abaixo.
   Passa por **App Review** da Meta pra funcionar fora do modo
   desenvolvimento.

   Lista conferida na doc oficial em 2026-08-14 — a doc lista conjuntos
   ligeiramente **diferentes** em duas páginas ("Retrieving Leads" e
   "Webhooks for Lead Ads"), então aqui está a união das duas, que é o
   conjunto seguro de pedir:

   - `leads_retrieval` — ler o lead em si (`GET /{leadgen_id}`).
   - `pages_manage_metadata` — **inscrever a Página no webhook**. É a que
     falta com mais frequência: sem ela não dá nem pra ativar a
     assinatura do campo `leadgen`, mesmo com todas as outras.
   - `pages_show_list` — listar as Páginas do Portfólio.
   - `pages_read_engagement` — ler dados da Página.
   - `ads_management` — acessar o lead com os dados de anúncio junto.
   - `pages_manage_ads` — citada na página "Retrieving Leads" (não na de
     webhooks); incluída por segurança.
2. **Assinar o campo `leadgen`** na Página, apontando a URL de callback
   pro Railway (`/integrations/meta-leads/webhook`) com o
   `META_VERIFY_TOKEN` combinado.
3. Configurar as 4 variáveis no Railway.
4. Aplicar a migration no banco (`prisma migrate deploy`).
5. **Testar ponta a ponta** — mesma metodologia do webhook eGestor:
   capturar um payload real via webhook.site primeiro (a Meta tem a
   ferramenta "Testar" no painel do App, que dispara um evento de
   exemplo), só depois apontar pro Railway e usar o formulário de teste
   da Central de Leads.
