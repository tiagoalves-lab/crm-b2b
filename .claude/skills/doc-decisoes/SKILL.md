---
name: doc-decisoes
description: Formato de documento de plano/decisão técnica deste projeto (docs/*.md) — decisões numeradas com "Decisão →"/"Fonte →" em vez de tabela, dúvidas marcadas com ❓ DÚVIDA embutidas na seção que afetam. Use sempre que for CRIAR ou ATUALIZAR um documento de plano de implementação, levantamento de decisões técnicas, ou qualquer doc em docs/ que precise ser lido e editado por um humano não-técnico (não só por outro agente).
---

# Formato de documento de plano/decisão (CRM B2B Gama)

Convenção fechada com o usuário em 2026-08-07 (`docs/regras-de-negocio.md`
é o exemplo vivo — consulte ele como referência de formato real, não só
este guia). Objetivo: um doc que sirva tanto pra eu reler entre sessões
quanto pra um humano ler e editar direto, sem fricção.

**Não vale pro roadmap**, que desde 2026-08-17 vive só no Kanban do Miro:
lá é só ação e status, **sem numeração em lugar nenhum** — nem em card,
nem em nome de raia, porque a prioridade muda toda semana e número
desalinha a cada reordenação.

## Regra 1 — decisões fechadas: lista numerada, nunca tabela

Tabela markdown com texto longo é difícil de escanear visualmente (cada
linha vira dois blocos de texto grudados, sem respiro). Em vez disso,
numerar (`1.1`, `1.2`, ...) e usar dois marcadores fixos:

```markdown
**1.1**
- Decisão → texto da decisão em si, direto ao ponto.
- Fonte → de onde veio (ex.: "Premissa do usuário", "Decisão do
  usuário, perguntada direto", "Testado contra a API real",
  "Observado na doc da API", "Código já existente no projeto").
```

Cada item numerado é auto-contido — dá pra citar "decisão 1.7" numa
conversa ou noutro doc sem ambiguidade.

## Regra 2 — nunca usar código HTML pra indentação

Nada de `&nbsp;&nbsp;`, `<br>`, ou qualquer entidade HTML só pra
empurrar texto visualmente. Isso só renderiza bonito numa preview
(GitHub, painel de preview do editor) — quem lê o arquivo bruto (texto
puro, sem preview) vê o código literal, que é pior que não ter
indentação nenhuma. Pra indentar, usar lista Markdown de verdade
(`- item`, aninhada com 2 espaços) — renderiza indentado na preview E
continua legível como texto puro.

## Regra 3 — dúvidas em aberto: marcador fixo, embutido onde importa

Toda pergunta minha que ainda não tem resposta do usuário leva o
marcador `❓ DÚVIDA` (não uma seção separada "perguntas" no fim do
documento) — cole a dúvida **dentro da seção que ela afeta**, logo
depois do trecho relevante. Facilita o usuário responder no contexto
certo, sem precisar pular entre seções lembrando qual dúvida era de
qual parte do plano.

```markdown
❓ **DÚVIDA — <resumo curto da pergunta>**: texto completo da pergunta,
com as opções/trade-offs que eu já enxergo (se houver), pra facilitar
a resposta do usuário. Pergunta objetiva, não um ensaio.
```

Quando o usuário responde (no chat ou editando o arquivo direto), a
dúvida devolvida vira uma decisão fechada — mover pra "Decisões já
fechadas" (Regra 1) com "Fonte → Decisão do usuário, perguntada direto"
(ou "Confirmado pelo usuário", se foi ele quem trouxe a resposta sem eu
perguntar antes), e apagar da seção original.

## Regra 4 — cabeçalho de "como usar este arquivo"

Todo doc de plano/decisão abre com uma nota curta (logo depois do título
e antes da seção 0/1) explicando que é um documento de trabalho, editável
pelo usuário, e o que fazer com os marcadores acima:

> **Como usar este arquivo**: toda dúvida minha que ainda não tem resposta
> está marcada com `❓ DÚVIDA`. Responde direto embaixo de cada uma (ou
> edita a linha), que eu releio antes de implementar. Itens já fechados
> entram na lista numerada.

## Regra 5 — escrever pra quem não é programador

O usuário lê estes documentos e não é programador (feedback explícito,
2026-08-14). Vale em todo doc de decisão:

- **Uma dúvida por vez.** Várias `❓ DÚVIDA` abertas ao mesmo tempo
  paralisam em vez de destravar — escolher a que desbloqueia as outras e
  guardar o resto numa seção "pra depois", dizendo que não precisa
  responder agora.
- **Sempre com recomendação.** Dúvida aberta traz as opções em linguagem
  de negócio (o efeito prático de cada uma), e termina com "minha
  recomendação: X". Levantamento de trade-off sem recomendação é ruído.
- **Sem jargão.** Nome de arquivo, função, tabela e contagem de teste só
  aparecem se forem indispensáveis pra decisão.
- **Decisão substituída se apaga**, não vira histórico riscado. O que não
  muda mais nenhuma decisão é lixo.

## Quando usar

Sempre que o pedido for "monte um plano", "documenta essas decisões",
"cria um arquivo pra gente trabalhar junto nisso" — qualquer doc que vai
ser lido/editado por um humano ao longo de várias sessões, não um
relatório de uma vez só. Não se aplica a docs técnicos de referência
puros (ex. `docs/api-egestor-*.md`, que documentam uma API externa, sem
decisão nem dúvida do usuário embutida) nem a comentário de código.
