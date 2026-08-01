# Feature: Preenchimento automático de cadastro via consulta de CNPJ

> Documentação extraída da implementação real em produção no projeto `gama-webapp`
> (arquivos `CnpjService.js` + `ClienteCadastro.html`). Escrita para outro agente/outro
> projeto replicar o recurso **em qualquer stack** — a lógica é descrita de forma
> agnóstica de tecnologia, com o código-fonte original (Google Apps Script) incluído como
> referência concreta ao final de cada seção.

## 1. O que o recurso faz (visão do usuário)

Na tela de cadastro de cliente/empresa, o campo **CNPJ** tem um botão de lupa (🔍) ao lado.
O usuário:

1. Digita o CNPJ (com ou sem pontuação — `12.345.678/0001-90` ou `12345678000190`, tanto
   faz).
2. Clica no botão de busca (ou aciona a mesma função de outra forma).
3. O botão entra em estado de carregamento (`...`) e fica desabilitado.
4. O sistema consulta uma API pública de CNPJ e, se encontrar, **preenche automaticamente**
   os demais campos do formulário (Razão Social, Nome Fantasia, Natureza Jurídica,
   Logradouro, Número, Complemento, Bairro, Município, UF, CEP).
5. Se der erro (CNPJ inválido, não encontrado, falha de rede), mostra uma mensagem de erro
   inline — **sem travar o formulário**: o usuário pode preencher os campos manualmente e
   salvar normalmente, com ou sem a consulta ter funcionado.
6. Nada é salvo automaticamente nesse passo — a busca só **preenche os campos em tela**; o
   salvamento continua sendo uma ação separada (botão "Salvar" do formulário).

Pontos de UX importantes de preservar:
- O clique em "Salvar" **não depende** da busca de CNPJ ter sido feita — é só um atalho de
  preenchimento, não uma validação obrigatória de fluxo.
- A busca **sobrescreve** os campos correspondentes do formulário (não faz merge campo a
  campo condicionalmente) — se o usuário já tinha editado algo manualmente antes de buscar,
  o clique na lupa substitui pelo valor vindo da API.
- O campo CNPJ em si não é sobrescrito pela busca (o valor de origem é o que o usuário
  digitou); os demais campos, sim.

## 2. Fonte dos dados: API pública de CNPJ (BrasilAPI)

Endpoint usado (gratuito, sem necessidade de API key):

```
GET https://brasilapi.com.br/api/cnpj/v1/{14 digitos do cnpj, sem pontuacao}
```

- **Sempre chamar a API pelo backend**, nunca direto do navegador. Dois motivos: (1) evita
  problema de CORS (a BrasilAPI não é garantida ter headers CORS abertos pra qualquer
  origem); (2) mantém o mapeamento de campos centralizado em um único lugar (o backend),
  então se a API mudar o formato de resposta, só um arquivo precisa mudar.
- Resposta de sucesso é um JSON com (entre outros) os campos: `razao_social` (ou `nome`,
  variação observada), `nome_fantasia` (ou `fantasia`), `natureza_juridica` (pode vir como
  string OU como objeto `{ descricao: "..." }` — **tratar as duas formas**), `logradouro`,
  `numero`, `complemento`, `bairro`, `municipio`, `uf`, `cep`.
- Em caso de erro (CNPJ não encontrado, malformado, etc.), a API responde com HTTP diferente
  de 200 e um corpo JSON que costuma ter `message` ou `error` com o motivo — repassar essa
  mensagem pro usuário quando possível, com um fallback genérico caso o corpo não seja JSON
  parseável.

## 3. Contrato do endpoint interno (backend do CRM)

Um único endpoint de backend expõe a busca pro frontend, escondendo a URL/lógica de
terceiros:

**Entrada**: uma string de CNPJ (com ou sem máscara — o backend normaliza).

**Validação**: extrair só os dígitos; se não tiver exatamente 14, retornar erro de
validação **sem chamar a API externa**.

**Saída (sucesso)**:
```json
{
  "ok": true,
  "data": {
    "cnpj": "12345678000190",
    "razao_social": "EMPRESA EXEMPLO LTDA",
    "natureza_juridica": "Sociedade Empresária Limitada",
    "fantasia": "Exemplo",
    "logradouro": "Rua Exemplo",
    "numero": "123",
    "complemento": "Sala 4",
    "bairro": "Centro",
    "municipio": "São Paulo",
    "uf": "SP",
    "cep": "01000000"
  }
}
```

**Saída (erro)**:
```json
{ "ok": false, "message": "CNPJ inválido. Informe 14 dígitos." }
```
(ou uma mensagem vinda do erro da API externa / erro de rede)

Notas de implementação que valem pra qualquer stack:
- `cep` sai **só com dígitos** (sem hífen) — a máscara visual, se houver, é responsabilidade
  do frontend.
- `uf` sai em maiúsculas.
- Todos os campos de texto vêm com `trim()` aplicado.
- O endpoint **nunca lança exceção pra CNPJ mal formado** — retorna `{ok:false, message}`
  de forma previsível, pro frontend não precisar tratar dois formatos de erro diferentes
  (validação vs. exceção).

### Referência: implementação original (Google Apps Script)

```js
// CnpjService.js
function cnpj_lookup_srv(cnpj) {
  const digits = String(cnpj || "").replace(/\D/g, "");
  if (digits.length !== 14) {
    return { ok: false, message: "CNPJ inválido. Informe 14 dígitos." };
  }

  const url = "https://brasilapi.com.br/api/cnpj/v1/" + digits;

  const resp = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true, // essencial: sem isso, HTTP != 200 vira exceção em vez de resposta
    headers: { "Accept": "application/json" }
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText() || "{}";

  if (code !== 200) {
    let msg = `Falha na consulta do CNPJ (HTTP ${code}).`;
    try {
      const j = JSON.parse(body);
      msg = (j.message || j.error) ? `${msg} ${(j.message || j.error)}` : msg;
    } catch (e) {
      if (body && body !== "{}") msg = `${msg} ${body}`;
    }
    return { ok: false, message: msg };
  }

  const j = JSON.parse(body);

  // Defensivo: a API já mudou o nome de alguns campos entre versoes/documentacoes.
  const razao = (j.razao_social || j.nome || "").toString().trim();
  const fantasia = (j.nome_fantasia || j.fantasia || "").toString().trim();
  const natureza_juridica = (j.natureza_juridica?.descricao || j.natureza_juridica || "").toString().trim();

  const logradouro = (j.logradouro || "").toString().trim();
  const numero = (j.numero || "").toString().trim();
  const complemento = (j.complemento || "").toString().trim();
  const bairro = (j.bairro || "").toString().trim();
  const municipio = (j.municipio || "").toString().trim();
  const uf = (j.uf || "").toString().trim().toUpperCase();
  const cep = String(j.cep || "").replace(/\D/g, "");

  return {
    ok: true,
    data: {
      cnpj: digits,
      razao_social: razao,
      natureza_juridica: natureza_juridica,
      fantasia: fantasia,
      logradouro: logradouro,
      numero: numero,
      complemento: complemento,
      bairro: bairro,
      municipio: municipio,
      uf: uf,
      cep: cep
    }
  };
}
```

**Adaptação pra outro backend** (ex.: Node/Express): a lógica é idêntica — só troca
`UrlFetchApp.fetch` por `fetch`/`axios`/`node-fetch`, mantendo:
- `muteHttpExceptions` → equivalente é **não deixar o fetch lançar** em status != 200; ler o
  corpo mesmo assim e decidir o que fazer (a maioria dos clients HTTP modernos já não lança
  em 4xx/5xx por padrão, só em erro de rede — nesse caso, `try/catch` em volta da chamada
  cobre os dois casos).
- Mesma normalização de dígitos, mesmo fallback de campos alternativos, mesmo `trim()`.

## 4. Frontend: campo + botão de busca

### HTML

```html
<div class="cnpj-wrap">
  <input type="text" name="cnpj" id="f_cnpj" class="control"
         placeholder="00.000.000/0000-00" required>
  <button type="button" class="btn btn-blue btn-icon" id="btnCnpj"
          onclick="searchCNPJ()" title="Consultar CNPJ">⌕</button>
</div>
```

```css
.cnpj-wrap {
  display: grid;
  grid-template-columns: 1fr 46px; /* input ocupa o espaco, botao fica com largura fixa ao lado */
  gap: 10px;
  align-items: center;
}
.btn-icon {
  width: 46px; height: 38px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center; padding: 0;
}
```

Detalhe: **não existe máscara de digitação** no campo (o usuário digita livre, com ou sem
pontuação) — o `placeholder` só indica o formato esperado visualmente. Toda a normalização
pra dígitos puros acontece no momento de ler o valor (tanto pra buscar quanto pra salvar).

### JavaScript

```js
function onlyDigits(v) { return String(v || "").replace(/\D/g, ""); }

function setCnpjLoading(on) {
  const btn = document.getElementById("btnCnpj");
  btn.disabled = !!on;
  btn.innerText = on ? "..." : "⌕";
}

// Preenche os campos do formulario cujo "name"/id bate com uma chave do objeto retornado.
// Generico o suficiente pra reaproveitar em qualquer tela que tenha os mesmos names.
function fillForm(data) {
  if (!data) return;
  const form = document.getElementById("frmCliente");
  Object.keys(data).forEach(k => {
    if (form.elements[k]) form.elements[k].value = (data[k] ?? "");
  });
}

window.searchCNPJ = function () {
  showError(""); // limpa erro anterior
  const cnpjDigits = onlyDigits(document.getElementById("f_cnpj").value);

  if (!cnpjDigits) return showError("Digite o CNPJ.");
  if (cnpjDigits.length !== 14) return showError("CNPJ inválido. Informe 14 dígitos.");

  setCnpjLoading(true);
  setStatus("Consultando CNPJ...");

  // Troque por um fetch/axios pro seu endpoint interno, se nao for Google Apps Script.
  google.script.run
    .withSuccessHandler(resp => {
      setCnpjLoading(false);
      setStatus("");

      if (!resp) return showError("Consulta retornou vazia.");
      if (resp.ok === false) return showError(resp.message || "Falha na consulta do CNPJ.");

      const payload = resp.data ? resp.data : resp;
      if (!payload) return showError("Consulta retornou vazia.");

      payload.cnpj = payload.cnpj || cnpjDigits; // garante que o cnpj digitado nao se perca
      fillForm(payload);
    })
    .withFailureHandler(err => {
      setCnpjLoading(false);
      setStatus("");
      const raw = (err && err.message) ? err.message : JSON.stringify(err);
      showError(raw.replace(/^((Error|Exception|ScriptError):\s*)+/gi, ""));
    })
    .cnpj_lookup_srv(cnpjDigits);
}
```

**Adaptação pra REST comum** (fora do Apps Script), a chamada vira algo como:

```js
window.searchCNPJ = async function () {
  showError("");
  const cnpjDigits = onlyDigits(document.getElementById("f_cnpj").value);
  if (!cnpjDigits) return showError("Digite o CNPJ.");
  if (cnpjDigits.length !== 14) return showError("CNPJ inválido. Informe 14 dígitos.");

  setCnpjLoading(true);
  setStatus("Consultando CNPJ...");
  try {
    const res = await fetch(`/api/cnpj/${cnpjDigits}`);
    const resp = await res.json();
    if (!resp || resp.ok === false) {
      showError((resp && resp.message) || "Falha na consulta do CNPJ.");
      return;
    }
    const payload = resp.data || resp;
    payload.cnpj = payload.cnpj || cnpjDigits;
    fillForm(payload);
  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  } finally {
    setCnpjLoading(false);
    setStatus("");
  }
};
```

### Mapeamento de campos → nomes do formulário

O `fillForm` funciona porque as **chaves do JSON de resposta batem exatamente com os
`name`/`id` dos inputs do formulário**. Essa é a convenção-chave a preservar ao replicar:

| Campo no JSON de resposta | `name`/id esperado no `<input>` |
|---|---|
| `cnpj` | `cnpj` |
| `razao_social` | `razao_social` |
| `fantasia` | `fantasia` |
| `natureza_juridica` | `natureza_juridica` |
| `logradouro` | `logradouro` |
| `numero` | `numero` |
| `complemento` | `complemento` |
| `bairro` | `bairro` |
| `municipio` | `municipio` |
| `uf` | `uf` |
| `cep` | `cep` |

Se o formulário de destino usar nomes de campo diferentes, o mais simples é ajustar o
mapeamento **no backend** (na hora de montar o `data` de retorno) em vez de mexer no
`fillForm` genérico — mantém o frontend reaproveitável em qualquer tela que precise do mesmo
padrão de "buscar e preencher".

## 5. Tratamento de erros — checklist

- [ ] CNPJ com menos/mais de 14 dígitos → erro de validação, **sem** chamar a API externa.
- [ ] API externa retorna HTTP != 200 (ex.: 404 pra CNPJ inexistente) → mensagem de erro
      legível, tentando extrair `message`/`error` do corpo JSON quando existir.
- [ ] Corpo de erro não é JSON válido → fallback pra mensagem genérica com o código HTTP.
- [ ] Falha de rede/timeout → capturada e mostrada, sem quebrar a tela.
- [ ] Em nenhum desses casos o formulário fica travado — o usuário sempre pode preencher
      manualmente e salvar.
- [ ] Estado de carregamento do botão (`disabled` + texto "...") é sempre revertido, mesmo
      em caso de erro (usar `finally`/reverter em ambos os callbacks de sucesso e falha).

## 6. Segurança / permissões (observação, não é bloqueante)

Na implementação original, `cnpj_lookup_srv` **não tem checagem de permissão** — qualquer
usuário autenticado no sistema pode chamar a busca (é uma consulta de dado público, sem
grava nada no banco). Ao replicar, considerar se isso é aceitável no novo projeto ou se vale
a pena colocar atrás do mesmo middleware de autenticação já usado nas outras rotas da tela de
cadastro (não precisa de permissão granular por módulo, só autenticação básica, já que não há
escrita nem exposição de dado sensível do próprio sistema).

## 7. Resumo do fluxo (pra implementar do zero)

1. **Backend**: endpoint que recebe um CNPJ, normaliza pra 14 dígitos, valida, chama
   `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}`, mapeia a resposta pros nomes de campo
   do formulário de destino, devolve `{ok, data}` ou `{ok:false, message}`.
2. **Frontend**: input de CNPJ (sem máscara obrigatória) + botão de busca ao lado, com
   estado de carregamento.
3. **Frontend**: ao clicar, normaliza o CNPJ digitado, valida 14 dígitos localmente, chama o
   endpoint, e em caso de sucesso preenche os campos do formulário cujo nome bate com a
   chave retornada (sobrescrevendo o que já estava preenchido).
4. **Frontend**: erro em qualquer etapa vira uma mensagem inline, sem bloquear o resto do
   formulário nem o botão de salvar.
