# API eGestor — Vendas / Ordens de Serviço (OS)

Documentação da API pública do eGestor usada na integração de importação
de histórico de vendas. Autenticação idêntica à de Contatos — ver
"Autenticação" em `api-egestor-contatos.md` (fluxo OAuth de 2 passos,
`personal_token` → `access_token`), não repetido aqui.

## `GET /api/v1/vendas` — Listar vendas / orçamentos / OS

```
https://api.egestor.com.br/api/v1/vendas
```

Um único endpoint cobre venda, orçamento e OS — o parâmetro `tipo`
distingue venda de orçamento (ver tabela abaixo). **Pro nosso
`SalesHistory` (que é histórico de vendas de verdade, não orçamento em
aberto), o sync deve filtrar `tipo=50`** (Venda) — sem esse filtro, a
listagem viria misturada com orçamento.

### Query parameters

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `page` | number | Paginação — mesmo padrão de Contatos (não listado explicitamente aqui, mas a resposta traz `current_page`/`last_page` igual; assumir mesmo mecanismo até confirmar). |
| `filtro` | string | Busca em: código da venda, palavras-chave, nome do cliente. |
| `dtTipo` | string | Qual data os filtros `dtIni`/`dtFim` usam. `dtVenda` (default), `dtCad` (data de cadastro), `dtEntrega`. |
| `dtIni` | date (`yyyy-mm-dd`) | Data inicial do filtro. **Isto é o que viabiliza carga incremental** — diferente de Contatos, que não tem filtro de data nenhum. |
| `dtFim` | date (`yyyy-mm-dd`) | Data final do filtro. |
| `vendedor` | integer | Código do vendedor. |
| `tipo` | integer | `10` = Orçamento, `50` = Venda. **Usar `tipo=50` no sync.** |
| `formaPgto` | integer | Filtra pela forma de pagamento dos financeiros da venda. |
| `contaDest` | integer | Filtra pela conta destino dos financeiros da venda. |
| `situOS` | string | Situação da venda (filtro). |
| `buscaObs` | string | Pesquisa nas observações da venda. |
| `fiscal` | string | `comNFe` / `semNFe`. |
| `listarCanceladas` | integer | `1` = normais + canceladas, `2` = só canceladas. **Omitir pra excluir canceladas do histórico** (comportamento default, a confirmar). |
| `fields` | string | Campos a retornar — ver lista abaixo. |
| `orderBy` | string | `campo,asc`/`campo,desc`. Campos aceitos: `codigo`, `codContato`, `codVendedor`, `clienteFinal`, `dtVenda`, `dtEntrega`, `dtCad`, `dtDel`, `valorTotal`, `valorFinanc`, `valorEntrada`, `numParcelas`, `tags`, `situOS`, `situacao`, `nomeContato`, `nomeVendedor`. |

#### Campos disponíveis (`fields`)

```
codigo, codContato, nomeContato, codVendedor, dtVenda, dtEntrega, dtCad,
valorTotal, valorFrete, valorFinanc, valorEntrada, numParcelas, codsNFe,
clienteFinal, situacao, situacaoOS, tags
```
Default se `fields` omitido: `codigo, codContato, nomeContato,
codVendedor, dtVenda, valorTotal, valorFinanc, codsNFe, situacao, tags,
ativo`.

**Para o sync, pedir explicitamente** (o default já cobre quase tudo que
precisamos, mas falta `situacaoOS` e `dtCad`):
```
codigo, codContato, dtVenda, dtCad, valorTotal, situacao, situacaoOS, tags
```

### `situacao` (numérico) × `situacaoOS` (texto) — dois campos distintos

Fácil de confundir:
- **`situacao`** (número): reusa o mesmo domínio do parâmetro `tipo` —
  `10` = Orçamento, `50` = Venda. É "que tipo de documento é este", não
  o andamento dele.
- **`situacaoOS`** (string): status da OS/venda em si. Mapeia direto pra
  `SalesHistory.situacaoOs`.

**Valores reais observados** (testado contra a conta real, amostra de 3
páginas por estabelecimento — não é a lista completa, só o que apareceu):
- Matriz: `Faturado + boleto`, `Finalizada`, `Em espera`, `Faturado`, `Entregue`
- Filial: `Finalizada`, `Em execução`, `Em espera`, `` (vazio — algumas vendas não têm `situacaoOS` preenchido)

**Decisão do usuário (2026-08-07)**: importar **todas** as vendas com
`tipo=50`, sem filtrar por `situacaoOS` — inclusive as ainda "Em
espera"/"Em execução". O sync não aplica nenhum filtro adicional além de
`tipo=50` (que já exclui orçamento). `situacaoOs` só é persistido pra
exibição (LTV soma `valorTotal` de tudo que entrar, sem distinguir
status).

### Request de exemplo

```bash
curl --include \
     --header "Content-Type: application/json" \
     --header "Authorization: Bearer [access_token]" \
  'https://api.egestor.com.br/api/v1/vendas?page=1&tipo=50&dtTipo=dtVenda&dtIni=2026-01-01&dtFim=2026-08-06&fields=codigo,codContato,dtVenda,dtCad,valorTotal,situacao,situacaoOS,tags&orderBy=dtVenda,asc'
```

### Response — `200 OK`

```json
{
  "total": 1,
  "per_page": 50,
  "current_page": 1,
  "last_page": 4,
  "next_page_url": null,
  "prev_page_url": null,
  "from": 1,
  "to": 50,
  "data": [
    {
      "codigo": 4,
      "codContato": 7,
      "nomeContato": "Cliente",
      "codVendedor": 1,
      "dtVenda": "2017-04-01",
      "valorTotal": 500,
      "valorFinanc": 500,
      "codsNFe": [],
      "situacao": 50,
      "clienteFinal": 1,
      "tags": [],
      "ativo": true
    }
  ]
}
```

### Response — `401 Unauthorized`

```json
{
  "errCode": 401,
  "errMsg": "Não foi possível acessar o sistema. Verifique seu \"access_token\".",
  "errObs": "access_denied",
  "errFields": null,
  "errUrl": "/v1/vendas"
}
```

## Mapeamento pra `SalesHistory` (referência rápida, ver schema em `prisma/schema.prisma`)

| Campo eGestor | Campo `SalesHistory` | Observação |
|---|---|---|
| `codigo` | `codVenda` (convertido pra string) | Chave de idempotência junto com `estabelecimento` — `@@unique([workspaceId, estabelecimento, codVenda])`. |
| `codContato` | `companyId` | Resolvido via `CompanyExternalRef` (lookup `codContato` → `companyId`, gravado durante o import de Contatos). **Pré-requisito**: sync de Contatos precisa rodar antes do de Vendas, senão venda de cliente ainda não importado fica órfã. |
| `dtVenda` | `dtVenda` | 1:1. |
| `valorTotal` | `valorTotal` | 1:1 (`Decimal`). |
| `situacaoOS` | `situacaoOs` | 1:1. |
| — | `estabelecimento` | **Não vem no payload** — inferido por qual conta/token (Matriz ou Filial) foi usado pra fazer a chamada, mesmo critério já usado em Contatos. |
| — | `fonte` | Fixo `"egestor"` (já é o default da coluna). |
| `situacao` | — | Só usado como filtro (`tipo=50`) pra excluir orçamento, não persiste. |
| `dtEntrega`, `dtCad`, `valorFrete`, `valorFinanc`, `valorEntrada`, `numParcelas`, `codsNFe`, `clienteFinal`, `codVendedor`, `nomeContato`, `tags` | — | Sem coluna correspondente em `SalesHistory` hoje. Fora do import nesta rodada, a menos que peça pra guardar algo (`codVendedor`, por ex., poderia virar atribuição de vendedor — fora de escopo do pedido atual). |

## Perguntas em aberto

1. ~~Paginação~~ — **resolvido**: mesmo parâmetro `page` de Contatos, confirmado contra a API real (`/v1/vendas?page=1...` funciona, `last_page` retorna corretamente).
2. ~~Valores de `situacaoOS`~~ — **resolvido, ver amostra acima**. Falta só a decisão de produto (quais valores contam pra `SalesHistory`, ver acima).
3. ~~`listarCanceladas`~~ — **resolvido pelo usuário (2026-08-07)**: default (parâmetro omitido) **exclui** canceladas — confirma a suposição inicial, não precisa passar o parâmetro no sync. Contexto de negócio importante que o usuário deu junto: "cancelada" no eGestor é **cadastro feito errado** (erro de digitação/duplicata), **diferente de devolução de venda** — uma venda devolvida não é "cancelada" nesse sistema, é outra coisa (situação/mecanismo ainda não identificado nos valores de `situacaoOS` testados — nenhum dos vistos soa como devolução).
   - ❓ **DÚVIDA** — como uma venda devolvida aparece na API? Sem exemplo real ainda; precisa saber antes de desenhar o tratamento (valor negativo? outro `situacaoOS`? campo booleano à parte?). Trava o item "Import de Vendas → SalesHistory" do roadmap.
4. **Limite de `dtIni`/`dtFim`** — não testado (só chamadas sem filtro de data até agora). Testar quando for implementar a carga incremental de verdade.
