# Integração com o app de cotações (gama-webapp)

Doc técnico da integração com o app de cotações da Gama (`c:\gama-webapp`,
Google Apps Script). O plano mestre da integração — decisões, fases e o
lado de lá — vive em `gama-webapp/planejamento/integracao-crm.md`; as
decisões de negócio do lado do CRM estão em `regras-de-negocio.md`
(decisões 3.10 e 3.13). No ar: **clientes** (fase 1, 2026-08-28) e
**Trello → funil** (2026-09-04, seção própria abaixo). Ainda prevista:
orçamento salvo → oportunidade, com o estágio do card acompanhando a
situação dos orçamentos.

## Direção e fonte de verdade

O CRM é a **fonte da verdade de clientes**. A tabela `clientes` do app de
cotações é um espelho somente-leitura, alimentado por aqui; cadastro/edição
feito na cotação chega como push (estilo webhook eGestor: quem envia não
consulta antes, quem recebe reconcilia).

Quem chama é sempre o **servidor** GAS (`gama-webapp/CrmService.js`) — o
navegador do app de cotações nunca fala com esta API e nunca vê o token.

## Autenticação

- Token estático `COTACOES_API_TOKEN` no header `Authorization: Bearer …`,
  conferido em `CotacoesService#assertTokenValido` com comparação em tempo
  constante (mesmo molde do `securityToken` do webhook eGestor).
- As rotas são `@Public()` (não há usuário Supabase na requisição) e estão
  declaradas em `ROTAS_PUBLICAS` do `test/idor.e2e-spec.ts`, com testes
  provando o controle substituto (401 sem token / token forjado, conferindo
  a mensagem exata pra saber qual camada recusou).
- Throttle por IP, 60 req/min por rota.
- O token é **gerado no GAS**: rodar `crm_config_instalar("https://URL-DA-API")`
  no editor do Apps Script do gama-webapp — grava nas Script Properties de
  lá e mostra o valor no log pra copiar pra env `COTACOES_API_TOKEN` no
  Railway. Nunca em código, docs ou chat. Vazou → rotacionar primeiro
  (apagar a Script Property, rodar de novo, trocar no Railway).

## `GET /integrations/cotacoes/companies` — varredura pro espelho

Query: `pagina` (default 1), `tamanho` (default 200, máx 500), `desde`
(ISO-8601, opcional — marca d'água incremental).

Escopo fixo: workspace `gama`, `deleted_at` nulo, `cpf_cnpj` preenchido,
**sem** a tag `lead-triagem` (company-lead em triagem não é empresa de
verdade — mesmo critério da tela Empresas). Ordenado por `updated_at, id`.

Resposta:

```json
{
  "itens": [{
    "id": "uuid", "cnpj": "só dígitos", "razao_social": "…", "fantasia": "…",
    "logradouro": "…", "numero": "…", "complemento": "…", "bairro": "…",
    "cidade": "…", "uf": "SC", "cep": "…",
    "indicador_ie": "1", "inscricao_estadual": "…",
    "atualizado_em": "ISO"
  }],
  "proxima_pagina": 2,
  "agora": "ISO"
}
```

- `indicador_ie`/`inscricao_estadual` vêm de `custom_fields` (enum eGestor:
  1 contribuinte, 2 isento, 9 não contribuinte) — o app de cotações vai usar
  no cálculo de DIFAL.
- `agora` é a marca d'água que o GAS grava e devolve como `desde` na
  varredura seguinte. Ela recua 5 min de propósito: company alterada durante
  uma varredura paginada poderia escapar da janela; a repescagem é barata
  porque o upsert do espelho (casado por CNPJ) é idempotente.

## `POST /integrations/cotacoes/clientes` — cadastro vindo da cotação

Body (`UpsertClienteDto`, snake_case espelhando as colunas de lá): `cnpj`
(14 dígitos, obrigatório), `razao_social` (obrigatório), `fantasia`,
`logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf`, `cep`,
`indicador_ie` (enum eGestor: 1/2/9, ou vazio), `inscricao_estadual`
(máx 30), `crm_company_id` (opcional — presente quando é edição de cliente
já vinculado).

`indicador_ie`/`inscricao_estadual` (desde 2026-08-31) são gravados em
`companies.custom_fields` com as mesmas chaves que o eGestor usa, em
**merge** (as demais chaves, ex. `cnpj_lookup`, ficam intactas). Campo
ausente no body não mexe na chave; enviado **vazio remove** — no
write-through o formulário da cotação é a verdade, limpar lá limpa aqui.
Esses campos não vêm de API pública (Receita não fornece IE) — são
digitados à mão na cotação, consultando o SINTEGRA da UF.

Comportamento (regra 3.10):

- **Com `crm_company_id`** → atualiza aquela company (mesmo que o CNPJ
  tenha sido corrigido no formulário). Company inexistente/apagada → 404.
- **Sem** → casa por CNPJ (`find_company_id_by_cnpj`, a mesma function do
  CompanyService — `cpf_cnpj` não tem unicidade no banco, o dedupe é da
  aplicação). Existe → devolve a existente **sem sobrescrever nada**.
  Não existe → cria direto em Empresas, **sem tag nenhuma** (o selo "Tipo"
  derivado das tags mostra **Lead**), sem passar pela Prospecção, com
  `dt_cad` de hoje.

Resposta: `{ "company": { …mesmo formato dos itens do GET… }, "ja_existia": true|false }`.

## Trello → funil (2026-09-04)

A tela "Trello | Solicitação de Propostas" do app de cotações lista os
cartões vivos da lista. Cada linha ganhou um botão que muda conforme o
cartão já tenha ou não oportunidade aqui (regra 3.13), mais um
"Sincronizar" que traz o chat do cartão pro chat do card.

Quem lê o Trello é o **GAS** (é ele que tem as credenciais do Trello);
o CRM só recebe o que ele leu. As três rotas seguem o mesmo regime das
duas de cliente: `@Public()` com token estático, declaradas em
`ROTAS_PUBLICAS` do `test/idor.e2e-spec.ts`, com teste de recusa por rota.

Colunas novas (migration `20260904180000_cotacoes_trello_vinculo`):
`opportunities.trello_card_id` / `trello_card_url` / `trello_sync_em` e
`opportunity_comments.external_ref`; mais
`opportunity_comments.external_author` na migration seguinte
(`20260904190000_comentario_autor_externo`). Duas unicidades, ambas **índices
parciais** escritos à mão no SQL da migration (o Prisma não sabe
declará-las): um cartão só tem uma oportunidade viva
(`workspace_id, trello_card_id` onde `deleted_at` é nulo) e uma mensagem
da origem só entra uma vez (`opportunity_id, external_ref`).

### `GET /integrations/cotacoes/trello-status?card_ids=…`

Ids do Trello (24 hex) separados por vírgula, no máximo 100 — uma chamada
por atualização da tela, não uma por linha. Responde só os cartões que
**têm** oportunidade viva:

```json
{ "itens": [{
  "card_id": "…", "opportunity_id": "uuid", "empresa": "…",
  "estagio": "Solicitação de Propostas", "status": "open",
  "itens": 3, "comentarios": 5, "sincronizado_em": "ISO"
}] }
```

### `POST /integrations/cotacoes/trello-vinculo`

Body: `card_id` (obrigatório), `card_url` (opcional, preso ao domínio do
Trello), `crm_company_id` **ou** `cnpj` (a empresa; sem os dois → 400),
`representante` (nome do quadro do Trello), `itens` (o que o cliente
pediu, vira a lista lateral do card) e `comentarios` (o chat do cartão,
formato abaixo).

**Representante** (2026-09-04): cada representante tem o quadro dele no
Trello ("LAURO BRANDÃO - SC"), então o quadro diz de quem é a cotação. O
nome do quadro é casado com o nome do membro do CRM (sem acento, sem
caixa: o primeiro nome do membro tem que ser o começo de uma palavra do
quadro) e vira o `owner_user_id` da oportunidade. Dois membros casando =
ambiguidade: cai no dono padrão, nunca chuta. Nome com menos de 4 letras
não entra na comparação. A identidade do membro vem do
`SupabaseUserService` (nome vive em `auth.users`), resolvida **antes** de
abrir a transação — é uma chamada HTTP, e segurar transação esperando HTTP
já estourou o pool antes. Quadro que não é de ninguém (representante sem
login no CRM) cai no dono padrão, e a correção é o campo Representante no
form de edição do card.

A oportunidade é criada pelo `OpportunityService` — não por um insert
paralelo: é ele que valida owner e estágio e emite a Activity de criação.
Nasce em **Solicitação de Propostas** (estágio resolvido por **nome** no
funil padrão, com o primeiro estágio como reserva — nunca UUID cravado),
`amount` 0 e moeda BRL. Dono: `COTACOES_DEFAULT_OWNER_USER_ID` se
configurado e ativo, senão o dono do workspace.

Idempotente: cartão que já tem oportunidade devolve a existente
(`ja_existia: true`) sem criar outra, e a corrida de dois cliques
simultâneos é barrada pelo índice único parcial → **409**, com a
transação inteira desfeita (não fica oportunidade órfã).

Resposta: `{ opportunity_id, ja_existia, estagio, comentarios_novos }`.

### `POST /integrations/cotacoes/trello-comentarios`

Body: `card_id` + `comentarios` (até 200), cada um
`{ ref, autor?, texto, em? }` — `ref` é o id da *action* do comentário no
Trello e vira `external_ref`. Cartão sem oportunidade → **404** (a tela
oferece "Cadastrar" nesse caso).

- **Só acrescenta.** O que já foi espelhado não entra de novo (filtro por
  `external_ref` + `skipDuplicates` pra corrida), e comentário escrito por
  gente no CRM (`external_ref` nulo) nunca é tocado. Apertar "Sincronizar"
  dez vezes tem o mesmo efeito de apertar uma.
- **O autor externo tem coluna própria** (`external_author`, 2026-09-04):
  quem escreveu no Trello não é usuário do CRM, então `author_user_id`
  recebe o sentinela de sistema e o nome de verdade vai em
  `external_author` — é ele que a ficha mostra, com a marca "via Trello".
  O corpo guarda só a mensagem. Antes o nome ia embutido no texto
  (`Trello · Fulano:`) e a tela mostrava o id do sentinela ("00000000…").
- **A data é a do Trello**, não a do espelhamento — o chat do card fica na
  ordem em que a conversa aconteceu.

Resposta: `{ opportunity_id, novos, recebidos }`.

## Carga inicial (feita em 2026-08-28)

Migração única, direto nos dois bancos (antes do endpoint existir), com
backups `backup_pre_cotacoes_20260828.companies` (aqui) e
`backup_pre_crm_20260828.clientes` (lá):

- 77 CNPJs existiam nos dois lados → vinculados (`clientes.crm_company_id`).
- 91 só existiam na cotação → criados aqui como company sem tags (selo
  Lead), `dt_cad` = data da carga.
- Conferência final: 168/168 vinculados, 0 órfãos, 0 CNPJs duplicados.

## Lado do app de cotações (referência)

`gama-webapp/CrmService.js`: `crm_cliente_salvar_srv` (write-through do
cadastro), `crm_espelho_sync_` (varredura incremental, gatilho horário
`crm_agendador_tick` + refresh ao abrir a lista de clientes),
`crm_config_instalar`/`crm_agendador_instalar`/`crm_agendador_status`
(instalação/diagnóstico no editor do Apps Script). A escrita anon na tabela
`clientes` de lá foi revogada — só o servidor GAS escreve no espelho.

Do Trello (2026-09-04): `crm_trello_status_srv` / `crm_trello_vincular_srv`
/ `crm_trello_sync_srv` no mesmo arquivo, `trello_card_comentarios_` e
`trello_cnpj_extrair_` no `TrelloService.js` (o CNPJ sai da descrição do
cartão, conferindo os dígitos verificadores), tela em `TrelloPicker.html`.
O link de "Ver Oportunidade" é montado no GAS a partir da Script Property
`CRM_WEB_URL` (padrão `https://crm.gamabrasil.com.br`).
