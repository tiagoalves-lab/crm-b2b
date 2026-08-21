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
| `codigo` | `codVenda` (convertido pra string) | Chave de idempotência junto com `estabelecimento` — `@@unique([workspaceId, estabelecimento, codVenda])`, criada na migration `20260820120000_sales_history_estabelecimento_vendedor`. |
| `codContato` | `companyId` | Resolvido pela tabela espelho `egestor_contatos_consolidado` (`codigoMatriz`/`codigoFilial` da linha já promovida → `companyId`). **Pré-requisito**: sync de Contatos + promoção precisam ter rodado antes, senão venda de cliente ainda não promovido fica órfã (contada e reportada, nunca descartada em silêncio). |
| `dtVenda` | `dtVenda` | 1:1. |
| `valorTotal` | `valorTotal` | 1:1 (`Decimal`). |
| `situacaoOS` | `situacaoOs` | 1:1. |
| — | `estabelecimento` | **Não vem no payload** — inferido por qual conta/token (Matriz ou Filial) foi usado pra fazer a chamada, mesmo critério já usado em Contatos. |
| — | `fonte` | Fixo `"egestor"` (já é o default da coluna). |
| `situacao` | — | Só usado como filtro (`tipo=50`) pra excluir orçamento, não persiste. No webhook, é reconferido no registro fresco: `situacao != 50` → evento ignorado. |
| `codVendedor` | `codVendedor` | Numeração por conta, igual a tudo no eGestor. |
| `nomeVendedor` | `vendedorNome` | Prefere o nome vindo de `GET /v1/usuarios` (cadastro oficial); cai pra este quando aquela chamada falha. |
| — | `vendedorUserId` | Membro do CRM correspondente ao vendedor, resolvido por e-mail (depois login, depois nome) contra `auth.users` — ver "Vendedor → membro do CRM" abaixo. Nulo quando não há correspondente. |
| `dtEntrega`, `dtCad`, `valorFrete`, `valorFinanc`, `valorEntrada`, `numParcelas`, `codsNFe`, `clienteFinal`, `nomeContato`, `tags` | — | Sem coluna correspondente em `SalesHistory` hoje. |

## Vendedor → membro do CRM (`GET /v1/usuarios`)

O cadastro de **contato** do eGestor não diz quem atende o cliente — essa
informação só existe na venda (`codVendedor`). O nome/login/e-mail de cada
vendedor vem de `GET /v1/usuarios?vendedor=1` (paginado igual ao resto).

Campos da resposta: `codigo`, `nome`, `login`, `email`, `tags`,
`usuarioSistema`, `vendedor`, `comisProd`, `comisServ`, `comisFin`.

**Casamento com o membro do CRM**: por **e-mail** primeiro (único e estável
dos dois lados), depois `login`, depois `nome` — nessa ordem, cada um só
entrando quando o anterior falhou. Vendedor sem correspondente fica com
`vendedorUserId` nulo e **aparece nomeado no resumo da sincronização**;
nenhum vínculo é inventado, porque um de-para errado viraria comissão e
curva ABC atribuídas à pessoa errada.

**O vínculo mora na venda, nunca em `companies.owner_user_id`** — quem
enxerga qual empresa é decisão de carteira (diretriz de acesso do
representante), e não pode ser efeito colateral de um import de histórico.

## `GET /api/v1/vendas/{codigo}` — Detalhar uma venda

Existe (confirmado contra a API real, 2026-08-20) e é o que o webhook usa
pra buscar o registro fresco depois de receber o aviso. Devolve bem mais
que a listagem: `codigo, codContato, nomeContato, codVendedor,
nomeVendedor, dtVenda, dtEntrega, dtCad, valorTotal, valorFinanc,
valorEntrada, valorFrete, numParcelas, codsNFe, codsNFSe, customizado,
clienteFinal, situacao, situacaoOS, tags, publicURL, ativo, produtos,
financeiros, despesas`.

Dois campos decidem o tratamento no webhook:
- **`situacao`** — `10` (orçamento) é ignorado; só `50` entra.
- **`ativo: false`** — venda cancelada no eGestor. O CRM **remove** a
  linha do histórico (cancelada ali quer dizer cadastro feito errado, não
  devolução — ver "Perguntas em aberto").

`financeiros`/`despesas` (forma de pagamento, despesas acessórias) não são
persistidos. `produtos` **é** — ver abaixo.

## `POST /api/v1/relatorios/vendasDetalhadas` — itens de todas as vendas

Fonte dos itens (`sales_history_item`), que sustentam as abas "ABC de
Produtos" e "Serviços" da ficha da empresa. **Não é paginado e devolve o
histórico inteiro numa chamada** — 607 KB / 1.001 vendas na Matriz e
40 KB / 87 na Filial, em menos de 400 ms (medido em 2026-08-21). Por isso
o sync faz uma chamada por conta em vez de buscar venda a venda.

Corpo usado pelo sync (as datas são **obrigatórias** aqui, diferente da
listagem de vendas — por isso a janela larga):

```json
{ "tipoData": "dtVenda", "de": "2000-01-01", "ate": "2100-12-31",
  "mostrarvendasConcluidas": 1, "mostrarOrcamentos": 0 }
```

Cada venda vem com `codVenda`, `dtCad`, `dtVenda`, `cliente`, `cpfcnpj`,
`vendedor` e `vendasItens[]`. Cada item: `codProd`, `produto`,
`tipoProd`, `quant`, `outros`, `custoUni`, `custo`, `venda`, `lucro`.

### Totais x unitários — a pegadinha das duas fontes

| Campo | No relatório (`vendasItens`) | No detalhe da venda (`produtos`) |
|---|---|---|
| Identificação | `codProd`, `produto` | `codProduto`, `descricao` |
| Tipo | `tipoProd` | `tipo` |
| Valor | `venda` — **já é o total do item** | `preco` — **unitário**; total = `quant × preco − vDesc` |
| Custo | `custo` — **já é o total** | `custo` — **unitário**; total = `quant × custo` |

Conferido item a item contra a mesma venda (2026-08-21): as duas contas
batem. A normalização acontece na entrada — `sales_history_item` guarda
**sempre o total**.

`tipoProd`/`tipo` só assumem `produto` e `servico`. Qualquer outro valor
faz o item ficar de fora e ser contado no resumo: chutar um dos dois lados
estragaria em silêncio justamente a divisão que a curva ABC mostra.

### A soma dos itens nem sempre fecha com o total da venda

Medido na carga real (2026-08-21): de 1.081 vendas, 86 têm soma dos itens
**menor** que o total (frete e despesas acessórias, que não são item) e 15
têm soma **maior** (desconto aplicado na venda inteira, não item a item).
Diferença líquida de R$ 3.494,90 em R$ 27,3 milhões — 0,01%.

Não é erro de import: é como o eGestor compõe o total. Por isso **LTV e
"total comprado" continuam saindo do total da venda**, nunca da soma dos
itens; os itens servem pra ranquear o que a empresa compra, não pra
refazer o faturamento.

## Perguntas em aberto

1. ~~Paginação~~ — **resolvido**: mesmo parâmetro `page` de Contatos, confirmado contra a API real (`/v1/vendas?page=1...` funciona, `last_page` retorna corretamente).
2. ~~Valores de `situacaoOS`~~ — **resolvido, ver amostra acima**. Falta só a decisão de produto (quais valores contam pra `SalesHistory`, ver acima).
3. ~~`listarCanceladas`~~ — **resolvido pelo usuário (2026-08-07)**: default (parâmetro omitido) **exclui** canceladas — confirma a suposição inicial, não precisa passar o parâmetro no sync. Contexto de negócio importante que o usuário deu junto: "cancelada" no eGestor é **cadastro feito errado** (erro de digitação/duplicata), **diferente de devolução de venda** — uma venda devolvida não é "cancelada" nesse sistema, é outra coisa (situação/mecanismo ainda não identificado nos valores de `situacaoOS` testados — nenhum dos vistos soa como devolução).
   - ❓ **DÚVIDA** — como uma venda devolvida aparece na API? Sem exemplo real ainda (valor negativo? outro `situacaoOS`? campo à parte?). **Não trava mais o import** (feito em 2026-08-20): o efeito de não tratar devolução é só o total comprado de um cliente ficar um pouco acima do real, e o ajuste é uma rodada de sincronização depois que aparecer o primeiro caso concreto.
4. ~~**Limite de `dtIni`/`dtFim`**~~ — **resolvido (2026-08-20)**: a listagem **sem** filtro de data devolve o histórico inteiro, mesmo total de uma janela `2000-01-01`→`2026-12-31` explícita (1.001 vendas na Matriz, 87 na Filial). O sync não passa filtro de data; carga incremental não é necessária enquanto o webhook mantiver em dia.
