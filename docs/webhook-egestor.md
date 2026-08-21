# API eGestor — Webhooks

Documentação da API pública do eGestor pra registro/consulta de webhook.
Fonte: doc oficial exportada pelo usuário (2026-08-12). Diferente de
`api-egestor-contatos.md`/`api-egestor-vendas.md` (que são pull —
o CRM chama o eGestor), aqui é **push**: o eGestor chama uma URL do
CRM sempre que um registro é criado/editado/excluído.

## Como funciona

- Webhook é **por conta eGestor**, não por workspace do CRM. Como a
  Gama tem duas contas (Matriz e Filial), cada uma precisa do próprio
  cadastro de webhook, com o próprio `endpoint` e o próprio
  `securityToken` — não existe um cadastro único que cubra as duas.
- Módulos disponíveis: **Produtos, Contatos, Vendas, Usuários,
  Financeiro**. No cadastro, cada módulo é ligado/desligado
  individualmente (`produtos`/`contatos`/`vendas`/`usuarios`/
  `financeiro`, booleano). O CRM processa **`contatos`** (desde
  2026-08-12) e **`vendas`** (desde 2026-08-20). Qualquer outro módulo
  é registrado e encerrado como `modulo_nao_suportado`, sem efeito.
  - **Estado real das duas contas (conferido em 2026-08-20)**: os
    **cinco** módulos estão ligados, não só os dois que interessam.
    Nenhum evento de produtos/usuários/financeiro chegou até hoje, mas
    se chegar vira linha inútil na tabela de eventos — vale desligar os
    três no cadastro quando houver oportunidade.
  - Venda é espelho de **mão única** (eGestor → CRM): o CRM nunca lança
    venda de volta (regra 4.2 das regras de negócio), então nenhum
    evento de venda pode ser eco da própria escrita — a checagem de eco
    só existe no fluxo de contatos.
- **`securityToken`**: gerado pelo eGestor no momento do cadastro
  (não é algo que a gente escolhe) — vem no `POST /webhooks` de
  resposta. É diferente do `personal_token`/`access_token` já usados
  no pull. Todo payload recebido traz esse token de volta — **é isso
  que autentica a requisição como vinda do eGestor de verdade**, tem
  que ser conferido no handler antes de processar qualquer coisa.
- **Timeout de resposta: 3 segundos.** O eGestor tenta até 5 vezes se
  não responder a tempo (ou se responder erro). Implicação pro CRM:
  o handler do webhook não pode processar side-effects pesados
  inline — recebe, valida `securityToken`, enfileira/agenda o
  processamento de verdade, responde `200` rápido. Sem fila
  implementada ainda no projeto — decidir mecanismo na hora de
  implementar (linha do roadmap: "Implementar webhook de contatos").
- Se `enviarComoJson: true` no cadastro, o corpo vem como JSON
  (`Content-Type: application/json`); senão vem `form-data` (default).
  Recomendado usar JSON pra facilitar o parse.

## Payload recebido (webhook em si)

Disparado toda vez que um produto/contato/venda/usuário/financeiro é
criado, editado ou excluído:

```json
{
  "action": "updated",
  "codigo": "1",
  "date": "2019-01-11 14:55:19",
  "module": "contatos",
  "securityToken": "01a161daaaf265968c1f36a19ef8f4"
}
```

| Campo | Valores possíveis | Observação |
|---|---|---|
| `action` | `created`, `updated`, `deleted` | |
| `codigo` | — | Código do registro alterado (mesmo `codigo` usado no pull, ex. `GET /contatos/{codigo}`). |
| `date` | — | Data/hora da alteração no eGestor. |
| `module` | `produtos`, `contatos`, `vendas`, `usuarios`, `financeiro` | Só chega o(s) módulo(s) habilitado(s) no cadastro. |
| `securityToken` | — | Conferir contra o token salvo pra essa conta (Matriz ou Filial) antes de confiar no payload. |

**O payload não traz o registro inteiro** — só avisa que `codigo` do
`module` mudou. Pra ter o dado atualizado, o handler precisa puxar de
volta via pull (`GET /contatos/{codigo}` ou equivalente) depois de
validar o evento — o webhook é só o gatilho, não substitui o cliente
HTTP de pull já existente.

## `GET /api/v1/webhooks` — Detalhar

Consulta o cadastro atual (útil pra confirmar o que já está
configurado numa conta antes de recadastrar).

```bash
curl --include \
     --header "Content-Type: application/json" \
     --header "Authorization: Bearer [access_token]" \
  'https://api.egestor.com.br/api/v1/webhooks'
```

Resposta — `200 OK`:
```json
{
  "endpoint": "http://www.example.com/webhookEgestor",
  "securityToken": "01a161daaaf265968c1f36a19ef8f4",
  "produtos": true,
  "contatos": false,
  "vendas": true,
  "usuarios": true,
  "financeiro": true,
  "enviarComoJson": false
}
```

## `POST /api/v1/webhooks` — Cadastrar

Cadastra o webhook da conta. **Confirmado contra a API real
(2026-08-12): atualiza o cadastro existente em vez de duplicar** —
rodar `POST` de novo pra Matriz (primeiro apontando pro webhook.site
de teste, depois pro endpoint real do Railway) devolveu o **mesmo**
`securityToken` das duas vezes, não um novo. Resolve a pergunta #1 de
"Perguntas em aberto" abaixo.

```bash
curl --include \
     --request POST \
     --header "Content-Type: application/json" \
     --header "Authorization: Bearer [access_token]" \
     --data-binary "{
  \"endpoint\": \"http://www.example.com/webhookEgestor\",
  \"produtos\": false,
  \"contatos\": true,
  \"vendas\": false,
  \"usuarios\": false,
  \"financeiro\": false,
  \"enviarComoJson\": true
}" \
'https://api.egestor.com.br/api/v1/webhooks'
```

Resposta — `200 OK` (é aqui que o `securityToken` novo vem, guardar
imediatamente — a doc não mostra um jeito de "revelar" o token depois,
só de ver que está cadastrado via `GET`):
```json
{
  "endpoint": "http://www.example.com/webhookEgestor",
  "securityToken": "b7e7d8d9185313c8738636c6bfc57d",
  "produtos": false,
  "contatos": true,
  "vendas": false,
  "usuarios": false,
  "financeiro": false
}
```

Autenticação de `GET`/`POST /webhooks` é a mesma dos endpoints de
pull (`access_token` via troca de `personal_token`, ver
`api-egestor-contatos.md` seção "Autenticação") — **por conta**, então
Matriz e Filial cadastram separadamente com o próprio `access_token`.

## Variáveis de ambiente

Nomes pra completar em `.env` (nunca commitar o valor — ver
`docs/seguranca.md`). O `securityToken` é sempre diferente por conta,
por isso entra como par Matriz/Filial, mesmo padrão de
`EGESTOR_API_TOKEN_MATRIZ`/`EGESTOR_API_TOKEN_FILIAL` já usado no pull:

```
EGESTOR_WEBHOOK_SECURITY_TOKEN_MATRIZ=
EGESTOR_WEBHOOK_SECURITY_TOKEN_FILIAL=
```

- `EGESTOR_WEBHOOK_SECURITY_TOKEN_MATRIZ`/`_FILIAL` — o `securityToken`
  que o eGestor devolve no `POST /webhooks` de cadastro de cada conta.
  **Preenchido pras duas contas** (Railway + `.env` local, nunca no
  chat/doc — ver `docs/seguranca.md`). Confirmado que recadastrar
  (`POST` de novo, trocando só o `endpoint`) mantém o mesmo token —
  não precisa gerar um novo a cada vez que o `endpoint` mudar (ver
  "Perguntas em aberto" #1, resolvida).

**A URL cadastrada não é variável de ambiente.** Existiram
`EGESTOR_WEBHOOK_ENDPOINT_MATRIZ`/`_FILIAL` no `.env.example` até
2026-08-14, mas nenhum código jamais as leu — quem sabe a URL é o
cadastro dentro do eGestor, não o CRM. Foram removidas pra não passarem
por configuração. Registro do que está cadastrado hoje nas duas contas
(desde 2026-08-12): `.../integrations/egestor/webhook/matriz` e
`.../integrations/egestor/webhook/filial`, apontando pro backend no
Railway. Pra conferir o valor vivo, `GET /api/v1/webhooks` na conta.

## Perguntas em aberto

1. ~~`POST /webhooks` cadastra ou substitui?~~ — **resolvido,
   confirmado contra a API real (2026-08-12)**: substitui/atualiza o
   cadastro existente da conta (mesmo `securityToken` nas duas
   chamadas de teste, endpoint diferente). Seguro de automatizar sem
   medo de duplicar.
2. **Não existe `DELETE`/`PUT` documentado** — só `GET` (detalhar) e
   `POST` (cadastrar) aparecem na doc anexada. Se for preciso
   desativar ou trocar só um módulo depois, não está claro se o
   caminho é `POST` de novo (sobrescrevendo) ou se há outro endpoint
   não documentado aqui.
3. **Retry (5 tentativas em 3s de timeout)** — não documentado se as
   5 tentativas usam backoff ou são imediatas, nem se todas mandam o
   mesmo payload (idempotente) ou se há algum id de evento pra
   deduplicar no lado do CRM. Tratar como **at-least-once**: o handler
   precisa ser idempotente por `(module, codigo, action, date)` até
   confirmar o contrário.
4. ~~Cadastro é manual (painel) ou só via API?~~ — **resolvido,
   confirmado (2026-08-12)**: só via API mesmo, `POST /webhooks`
   chamado manualmente (script ad-hoc, não uma rotina do CRM) uma vez
   por conta. Sem tela no painel do eGestor pra isso.

## Implementação no CRM

Rota receptora: `POST /integrations/egestor/webhook/:estabelecimento`
(`EgestorWebhookController`/`EgestorWebhookService`,
`src/integrations/egestor/`) — pública (`@Public()`, sem JWT do
Supabase, quem autentica é o `securityToken` do payload, comparado em
tempo constante).

`securityToken` recebido **nunca é persistido** — o `rawPayload`
salvo na tabela tem esse campo removido antes de gravar (é o mesmo
segredo que autentica os próximos webhooks daquela conta, não pode
virar linha de log legível).

### Fase 1 (2026-08-12) — registro puro

Só grava em `EgestorWebhookEvent` (RLS workspace-scoped, dedupe por
`(workspace, estabelecimento, module, codigo, action, date)` pros
retries do eGestor) e responde `200`. Testado ponta a ponta contra
produção — Matriz e Filial cadastradas, as duas confirmadas com evento
real gravando o `estabelecimento` certo.

### Fase 2 (2026-08-12, mesmo dia) — processamento operacional

Decisão do usuário: "vamos tornar o webhook operacional... ele será o
orquestrador, bastante alteração virá dele." Escopo expandido pra além
de só `contatos`: o evento agora dispara o mesmo pipeline do
"Sincronizar"/"Promover" manual, por contato só (não o lote inteiro).

**Achado que motivou um mecanismo novo**: confirmado contra a API real
que uma escrita do PRÓPRIO CRM (Corrigir/Consolidar/Corrigir SEFAZ/
Completar Matriz⇄Filial) dispara o MESMO webhook que uma edição manual
no eGestor — o payload não tem campo de origem/ator, não dá pra
diferenciar de outro jeito. Sem tratar isso, o processamento automático
reprocessaria a própria escrita do CRM como se fosse mudança externa.

**Mecanismo de eco** (`EgestorWebhookEchoService`, tabela
`EgestorWriteEcho`): toda escrita do CRM no eGestor registra um
marcador `(workspace, estabelecimento, codigo)` com TTL de 60s — folga
generosa sobre a latência real observada (~3s). O handler do webhook
consulta e CONSOME (apaga) o marcador antes de processar; se achar,
marca o evento como `eco_ignorado` e para ali, sem chamar a API do
eGestor de novo. One-shot — uma segunda edição legítima no mesmo
código minutos depois não fica suprimida por engano.

### Regras de negócio da orquestração (decisão do usuário, 2026-08-12;
**recalibrada em 2026-08-13** — ver "Correção da regra de hierarquia"
abaixo, a versão anterior desta seção tinha "Matriz sempre prevalece"
como regra única e isso misturava duas coisas diferentes)

1. **Matriz e Filial devem ter os dados IGUAIS** — exceto `codigo`
   (id interno de cada conta, nunca precisa bater entre as duas).
2. **Sem hierarquia fixa entre Matriz e Filial na correção
   automática.** Toda edição manual no eGestor veio de um humano que
   sabe o que está fazendo — a conta que **acabou de ser editada** (a
   que disparou o evento do webhook) é a fonte da verdade daquela
   mudança específica. O CRM propaga o valor da conta que mudou pra
   **outra** conta; nunca reverte quem mudou. Direção da correção =
   `estabelecimento` do evento recebido → o outro `estabelecimento`
   (já vem no payload/na URL do webhook, não precisa de campo novo).
3. **O webhook age como um "braço" do CRM**: uma alteração em qualquer
   uma das duas contas faz o CRM corrigir automaticamente a OUTRA —
   não é só ler e refletir no CRM, é escrever de volta no eGestor pra
   manter as duas bases de fato iguais.
4. Escrita automática registra eco (seção acima) — sem isso, o webhook
   disparado pela própria correção automática reprocessaria a si
   mesmo.
5. **Concorrência**: se Matriz e Filial forem editadas quase ao mesmo
   tempo (dois eventos chegando pro mesmo contato antes do primeiro
   terminar de processar), as alterações são aplicadas **na ordem em
   que os eventos chegam** — sem preferência por conta. Garantido por
   lock por contato no Postgres (`pg_advisory_xact_lock`, chaveado por
   CNPJ/linha do espelho): o segundo evento do mesmo contato espera a
   transação do primeiro liberar antes de ler o estado e decidir o que
   corrigir, senão os dois leriam o estado "antigo" ao mesmo tempo e a
   ordem de chegada deixaria de fazer diferença no resultado.
6. **"Completar Matriz⇄Filial" automático** (2026-08-13 — estendido
   depois de decisão explícita do usuário, revertendo o "fora de
   escopo" original abaixo): quando falta o contato inteiro de um lado
   (`so_matriz`/`so_filial`), o webhook agora CRIA automaticamente o
   registro que falta na outra conta — mesma lógica do botão manual
   "Completar Matriz ⇄ Filial"
   (`EgestorContatoCorrectionService#completarNoEgestor`). Só dispara
   quando (a) o evento **não** é `deleted` (nunca recria um registro
   que um humano acabou de apagar de propósito) e (b) o contato é
   **cliente** (mesmo filtro de `promoverLinha` — não espalha
   fornecedor/outro tipo pras duas contas). Mesma disciplina de eco
   (regra 4) e lock por contato (regra 5) das outras escritas
   automáticas.

### Correção da regra de hierarquia (2026-08-13)

A regra 2 acima **não é a mesma coisa** que a regra de exibição usada
em outro lugar do módulo — são duas decisões independentes, ficaram
mal separadas na primeira versão desta doc:

- **Exibição pro usuário do CRM** (ficha de Empresa, promoção pra
  `Company` — `EgestorContatoPromoteService#promoverLinha`): quando os
  dois lados divergem, o CRM usa o dado da **Matriz** pra não poluir a
  tela com dois valores conflitantes. Decisão de 2026-08-07, continua
  valendo — é sobre
  "o que pintar na tela quando há empate", não sobre qual conta está
  certa no eGestor.
- **Correção automática via webhook** (esta seção): **sem** viés pra
  Matriz. Quem mudou por último é quem está certo — o CRM propaga a
  mudança pra outra conta, não reverte a edição mais recente.

**Exemplo real que motivou a correção** (2026-08-13): contato MAGALI
tinha `tipo: [cliente, fornecedor]` nas duas contas (igual). Usuário
editou a Filial de propósito pra `tipo: [fornecedor]` (removeu
"cliente"), esperando que o CRM detectasse a divergência e propagasse
esse `tipo` novo pra Matriz também — não que revertesse a Filial de
volta pro valor antigo da Matriz. O comportamento anterior (regra 2
antiga, "Matriz sempre vence") fazia o oposto do esperado.

**Implicação explícita da regra nova**: se um campo divergir entre as
duas contas, o CRM corrige a conta que **não** foi o gatilho do
evento — ou seja, a direção muda evento a evento, não é fixa. Duas
edições manuais alternadas (Filial, depois Matriz, depois Filial de
novo) fariam o CRM propagar em direções diferentes a cada vez, sempre
seguindo a última edição humana.

**Ex-"fora de escopo" — completar automático agora implementado**
(2026-08-13, mesma sessão): a versão original desta doc deixava
**"Completar Matriz⇄Filial" automático** de fora — quando um lado não
tinha o contato (`so_matriz`/`so_filial`), o webhook não criava
automaticamente no lado que falta, ficava manual (botão "Completar
Matriz ⇄ Filial"). Motivo original: criar registro novo é mais
arriscado que corrigir campo de um registro que já existe nos dois
lados. **Gatilho da mudança**: usuário cadastrou um contato só na
Matriz ao vivo (contato SAMUEL RODRIGUES FERREIRA, 15:30) — o webhook
processou certinho (`processResult: "company_criada"`, confirmado no
log em produção), mas como esperado pela regra antiga NÃO criou na
Filial, ficando parado esperando o clique manual. Ao ver isso, o
usuário pediu pra estender o automático também pra esse caso — ver
regra 6 acima. O botão manual "Completar Matriz ⇄ Filial" continua
existindo (cobre os casos fora do gatilho automático: contato que não
é cliente, ou eventos anteriores a este deploy).

**Pipeline de processamento** (`EgestorWebhookProcessingService`),
quatro fases (mesmo racional de fetch-fora/persist-dentro de tx do
resto do módulo — network nunca dentro de transação). **Trava por
contato** (regra 5, `pg_advisory_xact_lock`) segura desde o começo da
fase 2 até o fim da fase 4, pra dois eventos do mesmo contato — um de
cada conta, chegando quase juntos — não se atravessarem:
1. Fora de tx — `GET /contatos/{codigo}` na conta que disparou o
   evento (só quando `action !== 'deleted'` — contato já não existe
   mais lá nesse caso).
2. Dentro de tx (adquire o lock por contato antes de ler; só leitura +
   cálculo) — monta a linha combinando o lado que mudou com o que já
   estava salvo do OUTRO lado no espelho (não busca o outro lado de
   novo — 1 única chamada à API por evento). Decide um dos três planos:
   - **Divergência real** (não só `tipo`, qualquer campo de
     `CAMPOS_CONTATO`) e os dois códigos existem → corrigir **na
     direção evento → outro lado** (regra 2 recalibrada).
   - **Falta um lado inteiro** (`so_matriz`/`so_filial`), evento não é
     `deleted` e contato é cliente → completar o lado que falta (regra
     6, 2026-08-13).
   - Nenhum dos dois → só avaliar/persistir a linha calculada.
3. Fora de tx (lock ainda segurado pela tx da fase 2/4, mesma conexão
   lógica), só quando o passo 2 pediu — aplica a correção automática OU
   o completar automático (`EgestorContatoCorrectionService`, direção/
   destino já calculados no passo 2) e volta com o dado real que ficou
   gravado no eGestor depois do `PUT`/`POST`.
4. Dentro de tx (libera o lock ao final) — registra o eco da escrita
   automática (se houve, regra 4), persiste o estado final (já
   corrigido/completado), e decide entre promover ou reconciliar com
   base no `tipo` da
   **Matriz** quando ela tem dado (regra de exibição, 2026-08-07 —
   independente da direção da correção acima), senão da Filial:
   - **É cliente**: promove/atualiza a `Company`
     (`EgestorContatoPromoteService#promoverLinha`) — **inclusive
     criando uma Company nova automaticamente** se for um contato
     nunca visto antes, sem esperar clique manual em "Promover".
   - **Não é cliente**: reconcilia
     (`EgestorContatoSyncService#reconciliarContatoUnico` — mesma
     regra do lote, soft-delete reversível da Company se já promovida,
     apaga a linha do espelho).

**Idempotência/retry**: evento já com `processedAt` setado nunca é
reprocessado num retry do eGestor (até 5x); evento já logado mas
`processedAt` nulo (ex.: processamento anterior falhou/deu timeout) É
reprocessado. Erro em qualquer fase propaga (não é engolido) — vira
`500`, e o próprio retry do eGestor dá uma nova chance, sem precisar de
fila/cron nenhum.

Testado ponta a ponta contra produção (2026-08-12), fluxo sem
divergência: contato já promovido reprocessado com sucesso
(`processResult: "atualizada"`); marcador de eco inserido manualmente +
evento simulado pro mesmo código confirmando supressão
(`processResult: "eco_ignorado"`, sem chamar a API — o código de teste
não existia de verdade, uma tentativa real de GET teria dado erro). A
correção automática de divergência (regras 1-4 acima) tem 17 testes
unitários novos (`egestor-webhook-processing.service.spec.ts`,
incluindo o caso real que motivou a regra — contato PF cliente+
fornecedor por engano, teste do usuário desmarcando só a Matriz) mas
**ainda não foi validada ao vivo contra o eGestor real** — próximo
teste do usuário serve como essa validação. **Cuidado observado**: um
teste local
levou ~3.75s (acima do timeout de 3s do eGestor) — provavelmente rota
de rede pior da máquina local até a API do eGestor do que o servidor
do Railway tem; vale observar se isso se repete em produção com
volume real (o desenho já tolera timeout/retry, mas retry constante
seria sinal de que vale investir em processamento assíncrono de
verdade, fora do ciclo request-response).
