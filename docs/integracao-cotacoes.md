# Integração com o app de cotações (gama-webapp)

Doc técnico da integração com o app de cotações da Gama (`c:\gama-webapp`,
Google Apps Script). O plano mestre da integração — decisões, fases e o
lado de lá — vive em `gama-webapp/planejamento/integracao-crm.md`; as
decisões de negócio do lado do CRM estão em `regras-de-negocio.md`
(decisão 3.10). Fase atual: **clientes** (fase 1). Fase 2 prevista:
orçamento salvo → oportunidade no Funil Padrão.

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
