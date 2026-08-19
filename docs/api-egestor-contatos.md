# API eGestor — Contatos (clientes)

Documentação da API pública do eGestor usada na integração de importação
de clientes. Fonte: doc oficial exportada + script real de extração em
Google Apps Script (já em produção, extrai pra planilha) que confirmou
detalhes que a doc oficial não deixava claros — ver seção "Autenticação"
e "Paginação" abaixo.

## Autenticação — fluxo real (2 passos, não é Bearer fixo)

O que a gente guarda em `.env` (`EGESTOR_API_TOKEN_MATRIZ`/
`EGESTOR_API_TOKEN_FILIAL`) é o **`personal_token`** — uma credencial de
longa duração, uma por conta eGestor (Matriz e Filial são contas
separadas, cada uma com o próprio `personal_token`). Ele **não** vai
direto no header `Authorization` das chamadas de dado — primeiro precisa
ser trocado por um `access_token` de curta duração:

**Passo 1 — trocar `personal_token` por `access_token`:**
```
POST https://api.egestor.com.br/api/oauth/access_token
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=personal&personal_token=<PERSONAL_TOKEN>
```
Resposta esperada: `{ "access_token": "..." , ... }`.

**Passo 2 — usar o `access_token` nas chamadas de dado:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Confirmado testando contra a API real**: `expires_in: 900` (15 minutos)
— vem também um `refresh_token`, não usado por ora. `EgestorClientService`
deve pedir um `access_token` novo no início de cada `sync` (não cachear
entre execuções) — 15 min é confortável pra uma rodada completa (Matriz +
Filial, contatos + vendas, ~40-45 páginas no volume atual, ~20-30s de
chamadas), mas o código não deve assumir vida longa além disso.

**Rate limit confirmado**: header `x-ratelimit-limit: 60` /
`x-ratelimit-remaining: N` em toda resposta — 60 requisições por minuto
(a julgar pela contagem regressiva observada). O sync precisa throttlar
pra não estourar (ex.: checar `x-ratelimit-remaining` e pausar se ficar
baixo, ou simplesmente espaçar as chamadas o bastante pra nunca passar de
~50-55/min com folga).

## `GET /api/v1/contatos` — Listar contatos

```
https://api.egestor.com.br/api/v1/contatos
```

### Query parameters

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `page` | number | **Página (confirmado no script de referência, não aparece na doc oficial)** — 1-based. Resposta traz `current_page`/`last_page`; paginar incrementando `page` até `page > last_page`. |
| `filtro` | string | Busca livre em: nome, fantasia, código, contato, email, telefone, tags. |
| `endereco` | string | Busca no endereço (rua, CEP, bairro, cidade, estado). |
| `telefone` | string | Busca no campo "Telefones". |
| `email` | string | Busca no campo "E-mails". |
| `clienteFinal` | number | Filtra por cliente final. `1` = Sim, `2` = Não. |
| `indIE` | number | Indicador de IE. `1` = Contribuinte, `2` = Isento de IE, `9` = Não contribuinte. |
| `IE` | string | Filtra por inscrição estadual. |
| `IM` | string | Filtra por inscrição municipal. |
| `suframa` | string | Filtra pelo código SUFRAMA. |
| `obs` | string | Busca nas observações do contato. |
| `fields` | string | Campos a retornar, separados por vírgula — ver lista abaixo. Sem este parâmetro, usa o default. |
| `orderBy` | string | `campo,asc` ou `campo,desc` — só um critério por request. Campos aceitos: `codigo`, `tipo`, `nome`, `fantasia`, `nomeParaContato`, `cpfcnpj`, `clienteFinal`, `indicadorIE`, `inscricaoEstadual`, `inscricaoMunicipal`, `suframa`, `emails`, `cidade`. |

**Sem filtro de data/incremental** — não existe parâmetro tipo
`alteradoDesde`/`updatedAfter` nesta doc nem no script de referência
(que sempre faz full-pull). A carga de **clientes** vai ser sempre
full-pull com upsert idempotente por `codigo` — não tem como pedir só
"o que mudou". (Vendas é diferente, tem filtro de data — ver
`api-egestor-vendas.md`.)

#### Campos usados na prática (`fields`)

O script de referência sempre pede a lista completa — vamos seguir o
mesmo padrão:
```
codigo, nome, fantasia, nomeParaContato, cpfcnpj, tipo, dtNasc, dtCad,
emails, fones, logradouro, numero, complemento, bairro, cep, cidade, uf,
clienteFinal, indicadorIE, inscricaoMunicipal, inscricaoEstadual,
suframa, obs, tags
```
(Default da API se `fields` for omitido: `codigo, nome, tipo, emails,
fones, cidade, uf, clienteFinal, tags` — não serve pra nós, falta
`cpfcnpj` e endereço.)

### Formato real de `emails`/`fones` (confirmado no script, não na doc)

São **arrays de objeto**, não de string — a doc oficial mostra `[]`
vazio nos exemplos, que não deixa isso claro. O script de referência
trata defensivamente, aceitando qualquer uma destas chaves por item:
- `emails[i]`: `item.email` ou `item.valor` ou `item.endereco`
- `fones[i]`: `item.fone` ou `item.telefone` ou `item.numero` ou `item.valor`

**Implementação deve seguir o mesmo padrão defensivo** (não assumir uma
chave fixa) — mapear pra `Company.emails`/`Company.fones` (`String[]`)
extraindo o primeiro campo não-vazio de cada item.

### `tipo` é array — filtrar só quem é cliente

```json
"tipo": ["cliente", "fornecedor"]
```
Um contato pode ser cliente E fornecedor ao mesmo tempo. **O sync
precisa filtrar só quem tem `"cliente"` no array** antes de fazer upsert
em `Company` — senão fornecedor puro entra como se fosse cliente da
Gama.

### Request de exemplo

```bash
curl --include \
     --header "Content-Type: application/json" \
     --header "Authorization: Bearer [access_token]" \
  'https://api.egestor.com.br/api/v1/contatos?page=1&fields=codigo,nome,fantasia,nomeParaContato,cpfcnpj,tipo,dtNasc,dtCad,emails,fones,logradouro,numero,complemento,bairro,cep,cidade,uf,clienteFinal,indicadorIE,inscricaoMunicipal,inscricaoEstadual,suframa,obs,tags&orderBy=codigo,asc'
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
      "codigo": "1",
      "tipo": ["cliente", "fornecedor"],
      "nome": "Nome do contato",
      "emails": [],
      "fones": [],
      "clienteFinal": false,
      "tags": [],
      "cidade": "Nome da cidade",
      "uf": "UF"
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
  "errUrl": "/v1/contatos"
}
```

## `POST /api/v1/contatos` — Criar contato

```
https://api.egestor.com.br/api/v1/contatos
```

### Attributes

| Atributo | Tipo (doc) | Obrigatório | Observação |
|---|---|---|---|
| `nome` | string (máx. 60) | **sim** | Nome do contato. |
| `fantasia` | string (máx. 60) | não | |
| `tipo` | array | **sim** | Ex.: `["cliente"]` — mesmo array de `GET /contatos`. |
| `nomeParaContato` | string (máx. 60) | não | |
| `cpfcnpj` | string | não | |
| `dtNasc` | string | não | Formato `YYYY-MM-DD`. |
| `emails` | array | não | |
| `fones` | array | não | |
| `cep` | number | não | |
| `logradouro`/`numero`/`complemento`/`bairro`/`cidade` | string | não | |
| `codIBGE` | string | não | Precisa ser um código IBGE válido. |
| `uf` | string | não | Deve ser o UF referente ao `codIBGE` informado. |
| `pais` | string | não | |
| `clienteFinal` | string (doc) | não | **Doc declara `string`, mas o exemplo real envia boolean (`true`)** — seguir o exemplo, não a tabela de atributos. |
| `indicadorIE` | enum | não | Mesmos valores do filtro `indIE` de `GET /contatos`: `1` = Contribuinte, `2` = Isento de IE, `9` = Não contribuinte. Ver nota sobre `0` em "Perguntas em aberto". |
| `inscricaoMunicipal`/`inscricaoEstadual`/`inscricaoEstadualST` | string | não | |
| `suframa` | string | não | |
| `obs` | string | não | |
| `tags` | array | não | |
| `cepEntrega`, `cpfCnpjEntrega`, `numeroEntrega`, `codIBGEEntrega` | number (doc) | não | **Doc declara `number`, exemplo real envia string** — mesma inconsistência de `clienteFinal`, seguir o exemplo. |
| `logradouroEntrega`/`complementoEntrega`/`bairroEntrega`/`ufEntrega`/`pontoRefEntrega`/`inscEstadualEntrega` | string | não | |
| `fonesEntrega` | string | não | Números separados por vírgula (não é array, ao contrário de `fones`). Doc oficial grafa como `fonesEntretga` (typo) — o exemplo real usa `fonesEntrega`, seguir o exemplo. |
| `emailsEntrega` | string | não | E-mails separados por vírgula (não é array, ao contrário de `emails`). |

Todos os campos de "…Entrega" só fazem sentido se o endereço de entrega for
diferente do endereço do cliente — ver `docs/api-egestor-contatos.md`
seção de mapeamento abaixo pra saber o que a Gama realmente usa.

### Request de exemplo

```bash
curl --include \
     --request POST \
     --header "Content-Type: application/json" \
     --header "Authorization: Bearer [access_token]" \
     --data-binary "{
  \"nome\": \"Empresa Exemplo LTDA\",
  \"fantasia\": \"\",
  \"nomeParaContato\": \"Nome do Contato\",
  \"cpfcnpj\": \"00000000000191\",
  \"tipo\": [\"cliente\"],
  \"emails\": [\"exemplo@example.com.br\"],
  \"fones\": [],
  \"logradouro\": \"Rua Exemplo\",
  \"numero\": \"999\",
  \"codIBGE\": \"3550308\",
  \"uf\": \"SP\",
  \"clienteFinal\": true,
  \"indicadorIE\": 9,
  \"tags\": []
}" \
'https://api.egestor.com.br/api/v1/contatos'
```

### Response — `200 OK`

```json
{
  "codigo": 1,
  "nome": "Nome do contato"
}
```

**Response minimalista** — só devolve `codigo`/`nome`, não o objeto
completo (diferente do `PUT`, que devolve tudo). Pra ter o registro
completo depois de criar, precisa de um `GET /contatos/{codigo}`
separado — não que a Gama vá usar `POST` na prática (o fluxo de escrita
desenhado é só correção via `PUT` em contato já existente, ver item 9.3
do roadmap), mas fica documentado pra referência.

## `PUT /api/v1/contatos/{codigo}` — Editar contato

```
https://api.egestor.com.br/api/v1/contatos/{codigo}
```

Mesmo corpo de atributos do `POST` acima — a doc oficial não lista quais
campos são obrigatórios no `PUT` especificamente (o exemplo manda o
objeto inteiro, `nome`/`tipo` incluídos). **Tratar como full update, não
patch parcial**: antes de gravar, montar o payload combinando o dado
atual do eGestor (`dadosMatriz`/`dadosFilial` já salvos em
`EgestorContatoConsolidado`) com só o(s) campo(s) que o usuário decidiu
corrigir — nunca mandar um objeto só com o campo alterado, sob risco de
apagar os demais campos do contato no eGestor (comportamento padrão de
`PUT`, não confirmado nem descartado contra a API real ainda — ver
"Perguntas em aberto").

### Request de exemplo

```bash
curl --include \
     --request PUT \
     --header "Content-Type: application/json" \
     --header "Authorization: Bearer [access_token]" \
     --data-binary "{
  \"nome\": \"Exemplo Company LTDA\",
  \"fantasia\": \"\",
  \"nomeParaContato\": \"Elfrieda\",
  \"cpfcnpj\": \"83294489654\",
  \"tipo\": [\"cliente\"],
  \"emails\": [\"exemplo@example.com.br\"],
  \"fones\": [],
  \"logradouro\": \"Rua Exemplo lado ímpar\",
  \"numero\": \"999\",
  \"codIBGE\": \"355030\",
  \"uf\": \"SP\",
  \"clienteFinal\": true,
  \"indicadorIE\": 1,
  \"tags\": []
}" \
'https://api.egestor.com.br/api/v1/contatos/{codigo}'
```

### Response — `200 OK`

Devolve o objeto completo do contato (diferente do `POST`, que devolve
só `codigo`/`nome`):

```json
{
  "codigo": "1",
  "tipo": ["cliente", "fornecedor", "transportadora"],
  "nome": "Nome do novo contato",
  "fantasia": "",
  "nomeParaContato": "",
  "cpfcnpj": "",
  "clienteFinal": true,
  "indicadorIE": 9,
  "inscricaoEstadual": "",
  "inscricaoEstadualST": "",
  "inscricaoMunicipal": "",
  "suframa": "",
  "emails": [],
  "logradouro": "",
  "numero": "",
  "complemento": "",
  "bairro": "",
  "cidade": "",
  "codIBGE": "",
  "uf": "",
  "cep": "",
  "pais": "",
  "fones": [],
  "tags": [],
  "obs": "",
  "dtNasc": "1990-05-12",
  "dtCad": "2017-01-15 11:20:15",
  "cpfCnpjEntrega": "",
  "logradouroEntrega": "",
  "numeroEntrega": "",
  "complementoEntrega": "",
  "bairroEntrega": "",
  "codIBGEEntrega": "0",
  "cidadeEntrega": "",
  "ufEntrega": "",
  "cepEntrega": 0,
  "pontoRefEntrega": "",
  "inscEstadualEntrega": "01234567",
  "fonesEntrega": "11999999999,11988888888",
  "emailsEntrega": "primeiro@teste.com,segundo@teste.com"
}
```

Note que o exemplo da doc oficial manda `indicadorIE: 1` no request e o
response de exemplo volta `9` — mesma suspeita já registrada: script de
referência converte
`indicadorIE: 0 → 9` antes de gravar. Ver "Perguntas em aberto" abaixo.

## Mapeamento pra `Company` (referência rápida, ver schema em `prisma/schema.prisma`)

| Campo eGestor | Campo `Company` | Observação |
|---|---|---|
| `codigo` | — (vira `CompanyExternalRef.externalId`) | Único dentro da conta (Matriz/Filial) — assumido único por conta, não global (ver "Perguntas em aberto"). |
| `nome` | `razaoSocial` | Passa por `resolveRazaoSocial()` (extrai "EM RECUPERAÇÃO JUDICIAL" se vier concatenado). |
| `fantasia` | `fantasia` | |
| `nomeParaContato` | `nomeParaContato` | |
| `cpfcnpj` | `cpfCnpj` | **Chave de dedupe** entre Matriz/Filial via `find_company_id_by_cnpj`. |
| `tipo` (array, filtrar `"cliente"`) | — | Não persiste; só decide se importa. PF/PJ (`Company.tipo`) inferido pelo tamanho do `cpfcnpj` (11 = CPF/PF, 14 = CNPJ/PJ), mesmo critério já usado em `lookupCnpj`. |
| `dtNasc` | `dtNasc` | |
| `dtCad` | `dtCad` | |
| `emails` | `emails` | Ver extração defensiva acima. |
| `fones` | `fones` | Ver extração defensiva acima. |
| `logradouro`/`numero`/`complemento`/`bairro`/`cep`/`cidade`/`uf` | idem | 1:1 |
| `tags` | `tags` | Cuidado: `Company.tags` já carrega o marcador de sistema `lead-triagem` em outros fluxos — tags do eGestor entram junto, sem conflito de nome esperado, mas confirmar que não colide. |
| `clienteFinal`, `indicadorIE`, `inscricaoMunicipal`, `inscricaoEstadual`, `suframa`, `obs` | — | Sem coluna correspondente em `Company` hoje. Fica de fora do import nesta primeira rodada, a menos que você peça pra guardar em `customFields`. |

### Reconciliação — contato que deixa de ser cliente (2026-08-12)

`tipo` só filtra na direção de **entrar** (`fetchClientes` só inclui
quem tem `"cliente"` no array). Achado real: um contato reclassificado
no eGestor (desmarcado "Cliente" nas duas contas) simplesmente sumia
do resultado do sync — sem nada que revisitasse quem caiu do filtro, a
`Company` promovida anteriormente ficava presa como cliente ativo pra
sempre. `EgestorContatoSyncService.persist()` agora roda
`reconciliarOrfas()` depois do upsert normal: CNPJ que estava no
espelho e não aparece mais como cliente em nenhuma das duas contas tem
a `Company` (se promovida) desativada por soft-delete (reversível,
reaproveita `CompanyService.remove()`) e a linha do espelho apagada
(staging, disposable).

## Perguntas em aberto

1. ~~Paginação~~ — **resolvido**: parâmetro `page`, 1-based, iterar até `page > last_page`.
2. ~~Autenticação / validade do token~~ — **resolvido**: OAuth de 2 passos, `access_token` expira em 900s. Ver acima.
3. ~~Endpoint de detalhe~~ — **resolvido, existe**: `GET /contatos/{codigo}` testado contra a conta real, respondeu `200`.
4. ~~Rate limit~~ — **resolvido**: 60 req/min (header `x-ratelimit-limit`/`remaining`).
5. **`codigo`** — ainda não confirmado se é único só dentro da conta (Matriz ou Filial separadamente) ou se as duas compartilham numeração. Baixo risco pra implementação: o dedupe de `Company` usa CNPJ (`find_company_id_by_cnpj`), não `codigo` — `codigo` só vira `CompanyExternalRef.externalId`, sempre escopado por `(workspaceId, sistema, estabelecimento, externalId)`, então mesmo que Matriz e Filial usem a mesma numeração por coincidência, não colide (a unique key inclui `estabelecimento`).
6. **`indicadorIE: 0`** — o script de referência converte `0 → 9` antes
   de gravar (`POST`/`PUT`); a doc oficial só documenta os valores `1`
   (Contribuinte)/`2` (Isento de IE)/`9` (Não contribuinte) como enum
   válido, `0` não aparece em lugar nenhum. Ainda não testado contra a
   API real se mandar `0` dá erro, é ignorado, ou é aceito e quebra
   silenciosamente — até confirmar, tratar como regra de negócio real:
   **nunca gravar `0`, mapear pra `9` (Não contribuinte) quando o dado
   de origem não tiver indicador de IE definido.**
7. **`PUT` — full update ou patch parcial?** — a doc oficial não deixa
   claro se o `PUT` aceita enviar só os campos alterados ou se sobrescreve
   com `null`/vazio qualquer campo omitido (comportamento comum de `PUT`
   REST, mas não confirmado contra esta API especificamente). Enquanto
   não for testado contra a conta real, tratar como full update
   obrigatório: sempre montar o payload combinando o dado atual salvo em
   `EgestorContatoConsolidado.dadosMatriz`/`dadosFilial` com o campo
   corrigido, nunca mandar um objeto parcial.
8. **Tipos divergentes entre a doc de atributos e os exemplos reais** —
   `clienteFinal` (doc: `string`, exemplo: `boolean`), `cepEntrega`/
   `cpfCnpjEntrega`/`numeroEntrega`/`codIBGEEntrega` (doc: `number`,
   exemplo: `string`) — seguir o formato dos exemplos até confirmar
   contra a API real qual tipo ela de fato aceita.
