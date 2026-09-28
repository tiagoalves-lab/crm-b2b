# Design System Gama Brasil

**O que é este documento**: a especificação da identidade visual dos
produtos digitais da Gama Brasil — cores, tipografia, espaçamentos,
componentes e regras de uso. Foi extraído do CRM B2B (primeiro produto a
usar o padrão) para que **qualquer produto novo nasça com a mesma cara**.

**Para quem é**: para o agente de IA (ou pessoa) que vai construir a
interface de um produto Gama. Não é documento de leitura — é
especificação para copiar.

## Como usar

1. Copie este arquivo para `docs/design-system-gama.md` do projeto novo.
2. Copie `logo-gama.svg` e `logo-gama-dark.svg` para a pasta de arquivos
   públicos do projeto novo.
3. Cole o bloco da seção 11 (CSS base) como folha de estilo global.
4. Construa as telas usando **só** os nomes de classe deste documento.
   Componente que não existe aqui: crie seguindo as regras da seção 10 e
   **acrescente a este documento** no mesmo commit.

Regra acima de todas: **nunca escrever cor, fonte ou medida solta no meio
do código**. Tudo vem das variáveis da seção 2.

---

## 1. Fundamentos técnicos

| Decisão | Valor |
| --- | --- |
| Framework de CSS | **Nenhum**. CSS puro num arquivo global, com variáveis (`--nome`) |
| Biblioteca de componentes | **Nenhuma**. Todo componente é HTML + classe deste documento |
| Ícones | SVG escrito à mão no próprio HTML, traço (outline), estilo Lucide/Feather |
| Tema | Claro por padrão. O tema escuro original está preservado na seção 2.6 |
| Densidade | Alta — é ferramenta de trabalho, não site institucional |

Por que sem framework: o padrão precisa sobreviver a troca de stack. Um
arquivo CSS e este documento bastam para reproduzir a identidade em
qualquer tecnologia.

---

## 2. Cores (tokens)

### 2.1 Superfícies e traços

| Variável | Valor | Onde usar |
| --- | --- | --- |
| `--bg` | `#f4f5f7` | Fundo da página e fundo de campo de formulário |
| `--surface` | `#ffffff` | Cartão, painel, tabela, barra lateral |
| `--surface-sunken` | `#eceef2` | Cabeçalho de tabela, botão secundário, faixa rebaixada |
| `--surface-hover` | `#e2e5eb` | Estado de mouse sobre elemento rebaixado |
| `--border` | `#dde1e7` | Traço padrão (moldura de cartão, divisor de linha) |
| `--border-strong` | `#c5cbd4` | Traço de campo editável e de cartão arrastável |

### 2.2 Texto

| Variável | Valor | Onde usar |
| --- | --- | --- |
| `--text-primary` | `#1a1e24` | Texto principal, título, valor de indicador |
| `--text-secondary` | `#5b6472` | Rótulo, texto de apoio, item de menu inativo |
| `--text-tertiary` | `#838c99` | Metadado, cabeçalho de tabela, legenda, estado vazio |

### 2.3 Azul da marca (acento)

| Variável | Valor | Onde usar |
| --- | --- | --- |
| `--accent` | `#052df4` | **Cor da marca** (vem da logo). Botão primário, foco, barra de destaque |
| `--accent-hover` | `#0322c9` | Mouse sobre botão primário |
| `--accent-soft` | `rgba(5, 45, 244, 0.08)` | Fundo de item de menu ativo, selo, faixa de progresso |
| `--accent-secondary` | `#2f5fe0` | Azul **sobre fundo claro** — texto de selo e de menu ativo |
| `--accent-secondary-soft` | `rgba(47, 95, 224, 0.1)` | Fundo alternativo do azul secundário |

Regra: `--accent` puro tem contraste baixo como texto. Texto azul usa
sempre `--accent-secondary`; `--accent` fica para preenchimento e traço.

### 2.4 Cores de significado

| Variável | Valor | Significa |
| --- | --- | --- |
| `--green` / `--green-hover` / `--green-soft` | `#1f8a4c` / `#186c3c` / `rgba(31,138,76,.1)` | Ganho, concluído, positivo |
| `--danger` / `--danger-soft` | `#c8402f` / `rgba(200,64,47,.1)` | Erro, perda, atraso, exclusão |
| `--warn` / `--warn-soft` | `#b45309` / `rgba(217,119,6,.1)` | Aviso, pendência, instrução de ordem |
| `--blue` / `--blue-soft` | `#2f80c9` / `rgba(47,128,201,.1)` | Categoria neutra (não é a cor da marca) |
| `--purple` / `--purple-soft` | `#7a52d6` / `rgba(122,82,214,.1)` | Categoria neutra |

As cinco cores de significado nunca decoram: cada uma carrega sentido.
Verde só aparece quando algo deu certo ou terminou; vermelho só quando
algo falhou, venceu ou vai ser apagado.

### 2.5 Paleta de séries (gráficos e colunas de quadro)

Sequência fixa, nesta ordem: `#9b7fe0` · `#4a9fe0` · `#5dcaa5` · `#f2a71b`.
Repete do começo se faltar cor.

### 2.6 Tema escuro (variante oficial)

Mesma estrutura, só os valores mudam. É o tema de origem do padrão —
mantenha-o disponível caso o produto novo precise.

```
--bg:#14181d  --surface:#1c222a  --surface-sunken:#252d37
--surface-hover:#323b47  --border:#2c343e  --border-strong:#3d4855
--text-primary:#e8eaed  --text-secondary:#9aa4b2  --text-tertiary:#6b7683
--danger:#e05a4a  --danger-soft:rgba(224,90,74,.15)
--shadow-sm:0 1px 2px rgba(0,0,0,.3)
```

---

## 3. Tipografia

### 3.1 As duas famílias

| Variável | Pilha | Papel |
| --- | --- | --- |
| `--font-ui` | `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif` | Todo texto de leitura |
| `--font-mono` | `"JetBrains Mono", "SF Mono", ui-monospace, "Cascadia Code", Consolas, monospace` | Rótulo, metadado, número, selo |

Nenhuma fonte é baixada de fora — o sistema operacional fornece. Isso
deixa a interface instantânea e coerente com o ambiente do usuário.

### 3.2 A regra que define o visual

**Monoespaçada + CAIXA ALTA + 10px + espaçamento entre letras = rótulo.**

É a assinatura visual do padrão. Vale para: cabeçalho de tabela, rótulo
de campo, título de seção do menu, nome de indicador, selo, data e hora,
contador. Nunca para frase que se lê.

```css
font-family: var(--font-mono);
font-size: 10px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 1px;
color: var(--text-tertiary);
```

### 3.3 Escala

| Uso | Tamanho | Peso | Detalhe |
| --- | --- | --- | --- |
| Base do documento | 14px | 400 | `line-height: 1.5` |
| Valor de indicador | 26px | 700 | `letter-spacing:-.5px`, `font-variant-numeric: tabular-nums` |
| Nome em ficha lateral | 19px | 600 | `letter-spacing:-.3px` |
| Título de página | 18px | 600 | `letter-spacing:-.2px` |
| Título de janela | 16px | 600 | |
| Título de painel | 14px | 600 | |
| Texto de tabela e de campo | 13px | 400 | |
| Botão | 13px | 600 | |
| Texto de apoio | 12px–12,5px | 400 | |
| Selo / pílula | 10px–11px | 600 | mono, caixa alta |

Título quanto maior, mais apertado o espaçamento entre letras (valor
negativo). Texto pequeno faz o contrário: espaça.

---

## 4. Forma, sombra e movimento

| Variável | Valor | Uso |
| --- | --- | --- |
| `--radius` | `6px` | Arredondamento padrão (botão, cartão, campo, painel) |
| `--shadow-sm` | `0 1px 2px rgba(20,24,29,.08)` | Elevação sutil |

Exceções de arredondamento: janela modal `8px`, cartão de acesso `14px`,
selo/pílula `999px` (cápsula), cartão de quadro `5px`.

Sombras fortes só em camada flutuante: janela `0 24px 60px rgba(0,0,0,.5)`,
ficha lateral `-20px 0 50px rgba(0,0,0,.4)`, aviso flutuante
`0 12px 30px rgba(0,0,0,.4)`.

Movimento: rápido e discreto. Mudança de cor `0,12s`; janela abrindo
`0,16s`; ficha lateral deslizando `0,22s`; aviso flutuante `0,25s`.
Nada pulsa, nada balança, nada demora meio segundo.

**Obrigatório**: respeitar quem desligou animação no sistema.

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
```

**Foco visível obrigatório** em todo elemento operável por teclado:

```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
```

---

## 5. Estrutura de tela

```
┌──────────┬────────────────────────────────────┐
│ marca    │ barra superior fixa (título + ação)│
│ ──────── ├────────────────────────────────────┤
│ SEÇÃO    │                                    │
│  item    │  conteúdo                          │
│  item    │  (folga 24px 28px 60px)            │
│ SEÇÃO    │                                    │
│  item    │                                    │
│ ──────── │                                    │
│ usuário  │                                    │
└──────────┴────────────────────────────────────┘
   220px
```

- **Coluna de navegação**: largura fixa de `220px`, fundo `--surface`,
  gruda na tela (`position: sticky`), altura total.
- **Topo da coluna**: logo; abaixo dela, o nome do produto em mono, caixa
  alta, 10px, `letter-spacing: 2px` — a marca é "GAMA", o produto é o
  resto.
- **Menu**: agrupado por seções. O título da seção usa a regra 3.2 em
  9px. Item ativo recebe fundo `--accent-soft`, texto
  `--accent-secondary` e traço `rgba(5,45,244,.35)`.
- **Rodapé da coluna**: identificação do usuário, empurrada para baixo.
- **Barra superior**: fixa no topo, fundo translúcido
  `rgba(244,245,247,.85)` com `backdrop-filter: blur(8px)`, traço
  inferior. Título à esquerda (com subtítulo em mono), ações à direita.

---

## 6. Camadas sobrepostas

| Camada | Comportamento | Empilhamento |
| --- | --- | --- |
| Barra superior | Fixa no topo | `z-index: 20` |
| Fundo escuro da ficha lateral | `rgba(10,12,15,.6)` + desfoque 2px | `90` |
| Ficha lateral | Entra pela direita, `50vw` (mínimo 640px, máximo 92vw) | `95` |
| Fundo escuro da janela | `rgba(10,12,15,.7)` + desfoque 3px | `100` |
| Aviso flutuante | Centro inferior | `200` |

Abaixo de 720px de largura, a ficha lateral ocupa a tela inteira.

**Regra de fluxo** (aprendida em produção): cadastro e edição acontecem
na **ficha lateral**, não em janela empilhada sobre janela. A janela
central serve para confirmação, formulário curto e escolha pontual.

---

## 7. Componentes

### 7.1 Botão — `.btn`

Base: 13px, peso 600, `8px 14px`, raio padrão, traço `--border-strong`,
fundo `--surface-sunken`.

| Variante | Aparência | Quando |
| --- | --- | --- |
| `.btn` | Cinza com traço | Ação secundária |
| `.btn-primary` | Azul sólido, texto branco | **Uma por tela** — a ação principal |
| `.btn-success` | Verde sólido | Concluir algo. Fica longe do salvar |
| `.btn-danger` | Vazado vermelho, preenche no mouse | Excluir, descartar |
| `.btn-ghost` | Sem fundo nem traço | Ação terciária, ícone isolado |
| `.btn-sm` | 12px, `5px 10px` | Dentro de tabela ou cartão |

Desabilitado: opacidade `.6`, cursor bloqueado, **e o estado de mouse
anulado** — senão o botão parece clicável travado.

### 7.2 Tabela — `.data-table`

Fundo `--surface`, moldura, cantos arredondados com `overflow:hidden`,
13px. Cabeçalho segue a regra 3.2 sobre `--surface-sunken`. Célula
`11px 14px`, divisor `--border`, última linha sem divisor. Linha inteira
muda de fundo no mouse. Coluna ordenável vira botão que herda toda a
tipografia do cabeçalho, com seta sempre presente (apagada quando
inativa) para o texto não pular.

`.mini-table` é a mesma coisa sem moldura própria — para tabela dentro de
um painel que já tem moldura.

### 7.3 Painel — `.panel`

`--surface` + moldura + raio. `.panel-head` (14px 18px, divisor
inferior): título 14px/600 à esquerda, ação à direita; ícone do título em
`--accent`, 16px. `.panel-body` com 18px de folga.

### 7.4 Indicador — `.stat-tile`

Cartão com **barra vertical de 3px colada na borda esquerda** (via
`::before`) — azul por padrão; `.blue`, `.green`, `.purple`, `.danger`
trocam a cor. Dentro: rótulo (regra 3.2), valor 26px/700 com números de
largura fixa, e uma linha de apoio em mono 11px. Variação sobe/desce em
verde/vermelho. Grade automática de no mínimo 150px por cartão.

### 7.5 Pílula de estado — `.pill`

Cápsula em mono 10px caixa alta **com um ponto colorido de 6px antes do
texto**, na cor do próprio texto. Variantes: `.pill-green`, `.pill-blue`,
`.pill-amber` (azul da marca), `.pill-purple`, `.pill-red`, `.pill-gray`.
Fundo sempre a versão suave da cor; texto, a versão forte.

### 7.6 Selo — `.badge`

Cápsula sem ponto, mono 11px/600, fundo `--surface-hover`. Variantes
`.badge-accent` e `.badge-danger`. Use para contagem e classificação;
`.pill` para estado de um registro.

### 7.7 Campo de formulário — `.field`

Rótulo pela regra 3.2. Campo com largura total, fundo `--bg` (mais escuro
que o cartão — o campo **afunda**), traço `--border-strong`, `9px 12px`,
13px. No foco: contorno padrão removido e traço trocado por `--accent`.
`.field-row` divide em duas colunas iguais.

Atenção: quando o rótulo envolve uma opção (marcar/escolher), ele **não**
é rótulo de campo — não herda mono nem caixa alta, e o marcador não estica.
Use grade de duas colunas (`16px | 1fr`) para os círculos ficarem
alinhados mesmo com textos de tamanhos diferentes.

### 7.8 Barra de ferramentas

Linha com busca à esquerda (ocupa o espaço livre, ícone dentro do campo à
esquerda, recuo de 36px), e à direita: botão de filtros (fica azul sólido
quando há filtro ativo, mostrando a contagem) e alternador de visão
`.seg` — grupo de botões numa moldura única, o ativo com fundo
`--surface-hover`.

### 7.9 Janela — `.modal`

Fundo escuro com desfoque; janela `--surface`, traço `--border-strong`,
raio 8px, largura máxima 520px (`.wide`: 720px), entrando com um leve
deslize de baixo. Três faixas: cabeça (título 16px + fechar), corpo
(22px), pé (ações **alinhadas à direita**, separadas por 10px, a
principal por último).

### 7.10 Ficha lateral — `.drawer`

Entra pela direita. Cabeça sobre `--surface` com nome 19px e metadados em
mono 11px. Abas logo abaixo: 13px, cinza, a ativa marcada por traço
inferior de 2px. Corpo com fundo `--bg`.

### 7.11 Linha do tempo — `.timeline`

Fio vertical de 2px à esquerda; cada registro tem um círculo de 20px com
fundo branco e traço de 2px — a cor do traço identifica o tipo. Cabeçalho
do item em mono 11px terciário.

### 7.12 Quadro (kanban) — `.board` / `.col` / `.card`

Colunas em grade automática, mínimo 200px. Cabeçalho da coluna:
quadradinho colorido de 8px (raio 2px) + nome 12px/600 + contagem em mono
dentro de cápsula + soma em mono terciário. Cartão: `--surface`, traço
`--border-strong`, raio 5px, cursor de arrastar. Coluna que recebe o
cartão ganha traço `--accent`.

### 7.13 Faixas de mensagem

Mesma forma (`8px 10px`, raio 8px, 12,5px), cor conforme o sentido:
`.error-banner` vermelho, `.info-banner` verde, `.lembrete-salvar`
âmbar com traço, `.busy-banner` azul **com um círculo girando** para
operação demorada — sem esse sinal, a espera é lida como travamento.

### 7.14 Aviso flutuante — `.toast`

Centro inferior, fundo `--surface-sunken`, **traço esquerdo de 3px em
verde**, sombra alta. Entra deslizando de baixo.

### 7.15 Estado vazio — `.empty`

Centralizado, 40px de folga, texto terciário, ícone de 32px com 40% de
opacidade. Toda lista precisa de um.

---

## 8. Ícones

- SVG escrito direto no HTML, `viewBox="0 0 24 24"`, sem preenchimento,
  traço `currentColor`, espessura 2 — mesma linguagem do Lucide/Feather.
- Classe `.ic`. Tamanhos: 15px no botão, 16px no menu e no título de
  painel, 32px no estado vazio.
- Herdam a cor do texto em volta. Nunca coloque cor fixa num ícone.

---

## 9. Marca

- Arquivos: `logo-gama.svg` (fundo claro) e `logo-gama-dark.svg`.
- Cores da logo: azul `#052df4` (é a origem do `--accent`) e azul-marinho
  `#020a26`.
- A logo aparece na tela de acesso e no topo da navegação. Abaixo dela, o
  nome do produto em mono caixa alta — **a marca não muda, o produto sim**.
- Não recolorir, não distorcer, não aplicar sombra na logo.

---

## 10. Regras para criar componente novo

1. Toda cor vem de variável. Cor escrita à mão só é aceita em rgba com
   transparência que a variável não cobre — e com comentário explicando.
2. Rótulo, metadado e número usam mono; frase usa a fonte de leitura.
3. Raio: `var(--radius)` salvo nas exceções da seção 4.
4. Fundo de campo é mais escuro que o do cartão; fundo de cartão é mais
   claro que o da página.
5. Cor com significado (verde/vermelho/âmbar) nunca é escolha estética.
6. Ação destrutiva nunca fica ao lado da ação principal.
7. Transição só em cor, fundo e traço — nunca em tamanho ou posição de
   conteúdo em lista.
8. Estado de mouse, foco, desabilitado e vazio: os quatro sempre
   previstos.
9. Componente novo entra neste documento no mesmo commit que o cria.

---

## 11. CSS base para colar

```css
:root {
  color-scheme: light;
  --bg: #f4f5f7;
  --surface: #ffffff;
  --surface-sunken: #eceef2;
  --surface-hover: #e2e5eb;
  --border: #dde1e7;
  --border-strong: #c5cbd4;
  --text-primary: #1a1e24;
  --text-secondary: #5b6472;
  --text-tertiary: #838c99;
  --accent: #052df4;
  --accent-hover: #0322c9;
  --accent-soft: rgba(5, 45, 244, 0.08);
  --accent-secondary: #2f5fe0;
  --accent-secondary-soft: rgba(47, 95, 224, 0.1);
  --blue: #2f80c9;
  --blue-soft: rgba(47, 128, 201, 0.1);
  --green: #1f8a4c;
  --green-hover: #186c3c;
  --green-soft: rgba(31, 138, 76, 0.1);
  --purple: #7a52d6;
  --purple-soft: rgba(122, 82, 214, 0.1);
  --danger: #c8402f;
  --danger-soft: rgba(200, 64, 47, 0.1);
  --warn: #b45309;
  --warn-soft: rgba(217, 119, 6, 0.1);
  --radius: 6px;
  --shadow-sm: 0 1px 2px rgba(20, 24, 29, 0.08);
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue",
    Arial, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, "Cascadia Code",
    Consolas, monospace;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 { margin: 0; text-wrap: balance; font-weight: 600; }
p { margin: 0; }
a { color: inherit; }
::selection { background: var(--accent-soft); }

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}

/* ---------- Estrutura ---------- */
.app-shell { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }

.sidebar {
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar-tagline {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.primary-nav { display: flex; flex-direction: column; padding: 10px; flex: 1; overflow-y: auto; gap: 1px; }

.nav-label {
  display: block;
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-tertiary);
  padding: 14px 10px 6px;
  font-weight: 600;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  border: 1px solid transparent;
  transition: background .12s, color .12s, border-color .12s;
}
.nav-item:hover { background: var(--surface-sunken); color: var(--text-primary); }
.nav-item[aria-current="page"] {
  background: var(--accent-soft);
  color: var(--accent-secondary);
  border-color: rgba(5, 45, 244, .35);
}

.topbar {
  padding: 16px 28px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(244, 245, 247, .85);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 20;
}
.page-title { font-size: 18px; font-weight: 600; letter-spacing: -.2px; }
.page-sub { font-size: 12px; color: var(--text-tertiary); font-family: var(--font-mono); margin-top: 1px; }

.content-wide { padding: 24px 28px 60px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }

/* ---------- Botões ---------- */
.btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface-sunken);
  color: var(--text-primary);
  cursor: pointer;
  line-height: 1.2;
  text-decoration: none;
  transition: background .12s, border-color .12s;
}
.btn:hover { background: var(--surface-hover); border-color: var(--text-tertiary); }
.btn .ic { width: 15px; height: 15px; }
.btn-primary { border-color: var(--accent); background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn-success { border-color: var(--green); background: var(--green); color: #fff; }
.btn-success:hover { background: var(--green-hover); border-color: var(--green-hover); }
.btn-danger { border-color: var(--danger); color: var(--danger); background: transparent; }
.btn-danger:hover { background: var(--danger-soft); }
.btn-ghost { border-color: transparent; background: transparent; color: var(--text-secondary); padding: 6px 8px; }
.btn-ghost:hover { background: var(--surface-sunken); color: var(--text-primary); }
.btn-sm { font-size: 12px; padding: 5px 10px; }
.btn:disabled, .btn:disabled:hover {
  opacity: .6; cursor: not-allowed;
  background: var(--surface-sunken); border-color: var(--border-strong);
}
.btn-primary:disabled, .btn-primary:disabled:hover { background: var(--accent); border-color: var(--accent); }
.btn-success:disabled, .btn-success:disabled:hover { background: var(--green); border-color: var(--green); }
.btn-ghost:disabled, .btn-ghost:disabled:hover { background: transparent; border-color: transparent; }
.btn-danger:disabled, .btn-danger:disabled:hover { background: transparent; border-color: var(--danger); }

/* ---------- Faixas de mensagem ---------- */
.error-banner { background: var(--danger-soft); color: var(--danger); font-size: 12.5px; padding: 8px 10px; border-radius: 8px; margin-bottom: 14px; }
.info-banner { background: var(--green-soft); color: var(--green); font-size: 12.5px; padding: 8px 10px; border-radius: 8px; margin-bottom: 14px; }
.lembrete-salvar {
  background: var(--warn-soft); color: var(--warn);
  border: 1px solid rgba(217, 119, 6, .28);
  font-size: 12.5px; line-height: 1.45; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px;
}
.busy-banner {
  display: flex; align-items: center; gap: 9px;
  background: var(--accent-soft); color: var(--accent);
  font-size: 12.5px; padding: 8px 10px; border-radius: 8px; margin-bottom: 14px;
}
.busy-banner::before {
  content: ""; flex: none; width: 13px; height: 13px;
  border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%;
  animation: busy-spin .7s linear infinite;
}
@keyframes busy-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .busy-banner::before { animation: none; } }

/* ---------- Tabela ---------- */
.data-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden;
}
.data-table th {
  text-align: left; font-family: var(--font-mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: 1px; color: var(--text-tertiary);
  font-weight: 500; padding: 10px 14px; background: var(--surface-sunken);
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
.data-table td { padding: 11px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--surface-sunken); }

.mini-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini-table th {
  text-align: left; font-family: var(--font-mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: 1px; color: var(--text-tertiary);
  font-weight: 500; padding: 10px 16px; background: var(--surface-sunken);
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
.mini-table td { padding: 11px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.mini-table tr:last-child td { border-bottom: none; }
.mini-table tr:hover td { background: var(--surface-sunken); }

/* ---------- Painel ---------- */
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 20px; }
.panel > .panel-head {
  padding: 14px 18px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.panel-title { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.panel-title .ic { width: 16px; height: 16px; color: var(--accent); }
.panel-body { padding: 18px; }

/* ---------- Indicadores ---------- */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 24px; }
.stat-tile {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 16px 18px; position: relative; overflow: hidden;
}
.stat-tile::before { content: ""; position: absolute; top: 0; left: 0; width: 3px; height: 100%; background: var(--accent); }
.stat-tile.blue::before { background: var(--blue); }
.stat-tile.green::before { background: var(--green); }
.stat-tile.purple::before { background: var(--purple); }
.stat-tile.danger::before { background: var(--danger); }
.stat-label {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 1px;
}
.stat-value {
  font-size: 26px; font-weight: 700; letter-spacing: -.5px; margin-top: 6px;
  color: var(--text-primary); font-variant-numeric: tabular-nums;
}
.stat-tile .sub { font-family: var(--font-mono); font-size: 11px; margin-top: 4px; color: var(--text-tertiary); }
.kpi-delta { font-family: var(--font-mono); font-size: 11px; margin-top: 4px; display: flex; align-items: center; gap: 4px; }
.up { color: var(--green); }
.down { color: var(--danger); }

/* ---------- Pílulas e selos ---------- */
.pill {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  padding: 3px 9px; border-radius: 20px; letter-spacing: .5px;
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
}
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill-green { background: var(--green-soft); color: var(--green); }
.pill-blue { background: var(--blue-soft); color: var(--blue); }
.pill-amber { background: var(--accent-soft); color: var(--accent-secondary); }
.pill-purple { background: var(--purple-soft); color: var(--purple); }
.pill-red { background: var(--danger-soft); color: var(--danger); }
.pill-gray { background: var(--surface-hover); color: var(--text-secondary); }

.badge {
  display: inline-block; font-family: var(--font-mono); font-size: 11px; font-weight: 600;
  padding: 2px 9px; border-radius: 999px; background: var(--surface-hover);
  color: var(--text-secondary); letter-spacing: .3px;
}
.badge-accent { background: var(--accent-soft); color: var(--accent-secondary); }
.badge-danger { background: var(--danger-soft); color: var(--danger); }

/* ---------- Formulário ---------- */
.field { margin-bottom: 16px; }
.field label {
  display: block; font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 1px; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px;
}
.field input, .field select, .field textarea {
  width: 100%; background: var(--bg); border: 1px solid var(--border-strong);
  border-radius: var(--radius); padding: 9px 12px; color: var(--text-primary);
  font-family: var(--font-ui); font-size: 13px; transition: border .12s;
}
.field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--accent); }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field .choice {
  display: grid; grid-template-columns: 16px 1fr; align-items: start; gap: 10px;
  margin-bottom: 0; font-family: var(--font-ui); font-size: 13px;
  text-transform: none; letter-spacing: normal; color: var(--text-primary);
}
.field .choice input { width: auto; }

/* ---------- Busca e alternador ---------- */
.search { flex: 1; min-width: 200px; position: relative; }
.search input {
  width: 100%; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 9px 12px 9px 36px; color: var(--text-primary); font-size: 13px;
}
.search input:focus { outline: none; border-color: var(--border-strong); }
.search .ic { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--text-tertiary); }

.seg { display: flex; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 2px; }
.seg button, .seg a {
  padding: 6px 12px; font-size: 12px; font-weight: 600; border: none; background: transparent;
  color: var(--text-secondary); border-radius: 4px; cursor: pointer; font-family: var(--font-ui); text-decoration: none;
}
.seg button.active, .seg a.active { background: var(--surface-hover); color: var(--text-primary); }

/* ---------- Janela ---------- */
.overlay {
  position: fixed; inset: 0; background: rgba(10, 12, 15, .7); backdrop-filter: blur(3px);
  z-index: 100; display: none; align-items: flex-start; justify-content: center;
  padding: 60px 20px; overflow-y: auto;
}
.overlay.open { display: flex; }
.modal {
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px;
  width: 100%; max-width: 520px; box-shadow: 0 24px 60px rgba(0, 0, 0, .5); animation: modal-pop .16s ease;
}
.modal.wide { max-width: 720px; }
@keyframes modal-pop { from { transform: translateY(8px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }
.modal-head { padding: 18px 22px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.modal-title { font-size: 16px; font-weight: 600; }
.modal-body { padding: 22px; }
.modal-foot { padding: 16px 22px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }

/* ---------- Ficha lateral ---------- */
.drawer-overlay { position: fixed; inset: 0; background: rgba(10, 12, 15, .6); backdrop-filter: blur(2px); z-index: 90; display: none; }
.drawer-overlay.open { display: block; }
.drawer {
  position: fixed; top: 0; right: 0; height: 100vh; width: 50vw; min-width: 640px; max-width: 92vw;
  background: var(--bg); border-left: 1px solid var(--border-strong); z-index: 95;
  transform: translateX(100%); transition: transform .22s ease;
  display: flex; flex-direction: column; box-shadow: -20px 0 50px rgba(0, 0, 0, .4);
}
.drawer.open { transform: translateX(0); }
.drawer-head { padding: 20px 24px; border-bottom: 1px solid var(--border); background: var(--surface); }
.drawer-co-name { font-size: 19px; font-weight: 600; letter-spacing: -.3px; line-height: 1.25; }
.drawer-co-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }
.drawer-tabs { display: flex; gap: 2px; padding: 0 24px; background: var(--surface); border-bottom: 1px solid var(--border); overflow-x: auto; }
.drawer-tab {
  padding: 11px 14px; font-size: 13px; font-weight: 500; color: var(--text-secondary);
  border: none; background: transparent; cursor: pointer; border-bottom: 2px solid transparent;
  white-space: nowrap; display: flex; align-items: center; gap: 6px; font-family: var(--font-ui); text-decoration: none;
}
.drawer-tab:hover { color: var(--text-primary); }
.drawer-tab.active { color: var(--text-primary); border-bottom-color: var(--accent); }
@media (max-width: 720px) { .drawer { width: 100%; max-width: 100%; min-width: 0; } }

/* ---------- Linha do tempo ---------- */
.timeline { position: relative; padding-left: 28px; }
.timeline::before { content: ""; position: absolute; left: 9px; top: 6px; bottom: 6px; width: 2px; background: var(--border); }
.timeline-item { position: relative; padding: 2px 0 14px 0; }
.timeline-item::before {
  content: ""; position: absolute; left: -28px; top: 0; width: 20px; height: 20px;
  border-radius: 50%; background: var(--surface); border: 2px solid var(--border-strong);
}
.timeline-item.type-purple::before { border-color: var(--purple); }
.timeline-item.type-blue::before { border-color: var(--blue); }
.timeline-item.type-green::before { border-color: var(--green); }
.timeline-item.type-amber::before { border-color: var(--accent-secondary); }
.timeline-item.type-red::before { border-color: var(--danger); }
.timeline-item-head { display: flex; gap: 8px; align-items: baseline; font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); flex-wrap: wrap; }

/* ---------- Quadro ---------- */
.board { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; overflow-x: auto; }
.col { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); min-height: 120px; display: flex; flex-direction: column; }
.col.drag-over { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.col-head { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
.col-head-top { display: flex; align-items: center; justify-content: space-between; }
.col-name { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 7px; }
.col-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.col-count { font-family: var(--font-mono); font-size: 10px; background: var(--surface-sunken); color: var(--text-secondary); padding: 1px 7px; border-radius: 8px; }
.col-sum { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }
.col-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.card { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 5px; padding: 11px; cursor: grab; }

/* ---------- Aviso flutuante e estado vazio ---------- */
.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100px);
  background: var(--surface-sunken); border: 1px solid var(--border-strong);
  border-left: 3px solid var(--green); padding: 12px 20px; border-radius: var(--radius);
  font-size: 13px; font-weight: 500; box-shadow: 0 12px 30px rgba(0, 0, 0, .4);
  z-index: 200; transition: transform .25s ease; display: flex; align-items: center; gap: 10px;
}
.toast.show { transform: translateX(-50%) translateY(0); }
.toast .ic { width: 16px; height: 16px; color: var(--green); }

.empty { text-align: center; padding: 40px; color: var(--text-tertiary); }
.empty .ic { width: 32px; height: 32px; margin: 0 auto 12px; opacity: .4; }

/* ---------- Ícones ---------- */
.ic { width: 16px; height: 16px; flex-shrink: 0; }
```

---

## 12. Checklist antes de publicar uma tela

- [ ] Nenhuma cor, fonte ou medida escrita fora das variáveis
- [ ] Um único botão azul na tela
- [ ] Todo rótulo e cabeçalho de coluna em mono caixa alta
- [ ] Toda lista tem estado vazio
- [ ] Todo botão tem estado desabilitado enquanto envia
- [ ] Operação demorada mostra a faixa azul com o círculo girando
- [ ] Ação destrutiva longe da ação principal
- [ ] Navegação por teclado com contorno de foco visível
- [ ] Cadastro/edição na ficha lateral, não em janela empilhada
- [ ] Componente novo documentado aqui
