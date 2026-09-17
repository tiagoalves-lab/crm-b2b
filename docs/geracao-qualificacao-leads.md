# Geração e Qualificação de Leads

> Complementa `arquitetura-dados.md`. Cobre o processo entre
> "lista bruta de empresas" (fora do CRM, via crawler) e "oportunidade
> qualificada no funil de vendas" (dentro do CRM). Decisões de código deste
> módulo ficam para depois — este documento fecha o processo primeiro.

## 1. Objetivo

Aumentar carteira de clientes ativos e gerar oportunidades de negócio,
transformando uma lista crua de CNPJs em uma fila de trabalho priorizada
para o time comercial — não uma planilha que ninguém trabalha até o fim.

## 2. Funil (visão geral)

```
Universo bruto (Receita Federal, por CNAE)
        │
        ▼
Enriquecimento (Econodata + filtros já existentes no crawler)
        │
        ▼
Triagem na Prospecção (classificação manual)
        │
   ┌────┼────────────────┐
   ▼    ▼                ▼
Curto  Médio           Longo
Prazo  Prazo           Prazo
   │    │                │
   │    └─ fila de       └─ sem ação imediata
   │       pré-qualificação   (pode ser reclassificado
   │       manual (call de     a qualquer momento)
   │       descoberta)
   ▼
Company + Opportunity no CRM,
estágio "Qualificação", atribuída
a um rep (SLA de 1º contato: 48h)
```

## 3. Fontes de dados

| Fonte | O que fornece | Status |
|---|---|---|
| Receita Federal (Dados Abertos) | Razão social, CNAE, porte, UF, telefone/e-mail, data de abertura, sócios | ✅ Implementado — script de crawler (`leads/cod.txt`) |
| Econodata | Volume de importação do exterior por empresa | ⚠️ Formato ainda não levantado — ver seção 7 |

## 4. Import de empresas (staging)

Passo entre "planilha gerada pelo crawler" e "dado pronto pra pontuar" —
sem isso, cada execução do crawler vira uma planilha nova e desconectada
da anterior, sem histórico e sem forma de saber o que já foi visto.

**Decisão de arquitetura:** staging separado do CRM, não o banco do CRM
diretamente. O schema do CRM (`Company`, `Workspace`) ainda não existe —
a etapa de modelo de dados + RLS não começou. Import direto pro CRM teria
que adiantar essa etapa só pra desbloquear o módulo de leads, o que
inverteria a ordem de dependência que o roadmap definiu por um motivo (RLS testado
antes de qualquer dado real trafegar). Fica pra quando a Fase 1 estiver
pronta — ver seção 9.

**O que existe:** `leads/import_empresas.py` — lê a mesma planilha do
Google Sheets que o crawler (`leads/cod.txt`) gera e grava/atualiza num
DuckDB local (`leads_staging.duckdb`, tabela `leads`).

- **Idempotente por CNPJ** — `INSERT ... ON CONFLICT (cnpj) DO UPDATE`.
  Rodar de novo com a planilha atualizada não duplica linha; atualiza os
  campos (telefone, porte, etc.) e preserva a data da 1ª vez que aquele
  CNPJ apareceu (`primeira_importacao`), o que dá histórico de quando cada
  empresa entrou no radar.
- **Abertura normalizada** — o crawler grava `Abertura` como string
  `AAAAMMDD`; o import converte pra `DATE` de verdade (`data_abertura`),
  já deixando pronto pro cálculo de "tempo de mercado" do modelo de score
  (seção 6).
- **Log de execução** — tabela `import_log` com timestamp, linhas lidas,
  novos vs. atualizados, total após — histórico de cada rodada, útil pra
  depurar se algo no crawler mudou o formato da planilha sem avisar.
- Roda em Colab, mesmo padrão do crawler (usa `google.colab.auth`).

## 5. Perfil de cliente ideal (ICP) — estado atual

O crawler já implementa a primeira camada de filtro, que define o ICP hoje:
matriz, ativa, não-MEI, não-Micro, aberta antes do ano de corte configurado,
com telefone ou e-mail, CNAE nas divisões configuradas (hoje 25–30:
fabricação de produtos de metal → fabricação de outros equipamentos de
transporte — perfil industrial).

## 6. Classificação do lead

**Decisão →** A classificação é **manual**, feita pelo time na tela de
Prospecção: Curto Prazo, Médio Prazo, Longo Prazo ou sem classificação.
Não existe pontuação automática por regras — nem na tela, nem como
critério de ordenação da fila (a lista sai em ordem alfabética).

**Fonte →** Usuário, 2026-09-14: o score de 0–100 que o CRM calculava
sozinho saiu da interface inteira ("não vamos usar isso"). Ele classificava
todo lead automaticamente por CNAE/porte/situação, o que na prática
apontava prioridade sem o time ter olhado o lead.

## 7. Dado de importação (Econodata)

O volume de importação aparece na ficha do lead como **informação de
contexto para o rep** — ajuda a interpretar o lead, não classifica nada
sozinho. Ler caso a caso: importar muito tanto pode significar que a
empresa já resolve com fornecedor estrangeiro quanto que ela tem budget e
demanda ativa na categoria.

## 8. Cadência operacional

- Rodar o crawler mensalmente — a Receita atualiza a base mensalmente e o
  script já aponta para a pasta do mês (`MES` no `leads/cod.txt`).
- Rodar o import (`leads/import_empresas.py`) logo depois, na mesma sessão
  — mantém o staging sincronizado com a planilha mais recente.
- Enriquecer com Econodata na mesma janela, mesmo que manual até a
  integração de formato ficar clara (seção 7).
- Distribuir os leads de Curto Prazo entre os reps — round-robin como ponto
  de partida; evoluir para distribuição por território/setor quando o volume
  justificar.
- SLA de primeiro contato: 48h para Curto Prazo. Médio Prazo entra em fila
  de nutrição/descoberta sem SLA rígido — não compete pela atenção imediata
  do rep.

## 9. Do lead qualificado para o CRM

Quando um lead é classificado como Curto Prazo:

1. Cria-se `Company` no workspace, com os campos capturados pelo crawler
   mais os da Econodata guardados em `custom_fields` (jsonb — ver
   `arquitetura-dados.md`, seção 2).
2. Cria-se uma `Opportunity` inicial no pipeline padrão, estágio
   "Qualificação", `owner_user_id` = rep designado pela distribuição
   round-robin.
3. Gera-se uma `Activity` do tipo `note` registrando a origem
   (`"Lead gerado via crawler CNAE"`), preservando a rastreabilidade de onde
   cada oportunidade veio — útil mais adiante para medir taxa de conversão
   por fonte.

Leads de Médio Prazo viram `Company` sem `Opportunity` — ficam disponíveis para
qualificação manual sem poluir o funil de vendas ativo. Depende da Fase 1
do CRM (`Company`/`Workspace`/RLS) estar pronta — hoje o staging (seção 4)
é o único lugar onde os dados de fato existem.

## 10. Resumo/qualificação assistida por IA (Claude)

Camada de apoio à classificação manual (seção 6) — **não classifica no
lugar do time, resume**: responde "por que esse lead interessa (ou não)",
em linguagem que o rep entende em 5 segundos.

**Arquitetura:**

- Módulo novo no backend NestJS (`AiModule` → `LeadQualificationService`),
  usando o SDK oficial da Anthropic (`@anthropic-ai/sdk`) — mesma stack do
  resto da API, sem infraestrutura nova.
- Entrada: os campos já capturados pelo crawler + os da Econodata (quando o
  formato da seção 7 estiver resolvido).
- Saída **estruturada** (JSON Schema via `output_config.format`, não texto
  livre) para poder ser salva e filtrada como dado, não só lida:

  | Campo | Conteúdo |
  |---|---|
  | `resumo` | 1–2 frases sobre por que esse lead é (ou não) prioritário |
  | `red_flags` | Lista curta de pontos de atenção (ex.: sócio único, abertura recente, setor fora do core) |
  | `leitura_importacao` | Leitura qualitativa do dado da Econodata para *aquele* lead específico — só dá contexto |
  | `sugestao_abordagem` | Um gancho de abordagem inicial pro rep usar no primeiro contato |

- Modelo: Claude Opus 4.8, uma chamada por lead (não é tarefa aberta o
  bastante pra justificar tool use ou um agente autônomo).
- Grava como `Activity` tipo `note` na `Company`/`Opportunity` recém-criada,
  junto com a nota de origem já prevista na seção 9 — mesmo padrão de
  rastreabilidade.

**Custo/operacional:** uma chamada por lead de Curto/Médio Prazo (não vale
rodar em todo o universo bruto — só depois do filtro do crawler). Requer
`ANTHROPIC_API_KEY` nas variáveis de ambiente (`.env`), mesmo padrão dos
outros secrets do projeto.

---

**Estado atual (2026-09-14):** crawler (seção 3), import/staging (seção 4) e
triagem na Prospecção com classificação manual (seção 6) no ar. Promoção
automática pro CRM (seção 9) e camada de IA (seção 10) ainda são desenho.
