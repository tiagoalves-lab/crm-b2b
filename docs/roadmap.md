# Roadmap — CRM B2B Multi-tenant

> Referência: `arquitetura-dados.md`. Fases pensadas para entregar valor
> incremental — cada uma produz algo demonstrável, não apenas infraestrutura.

## Fase 0 — Fundamentos técnicos (pré-requisito)
- [x] Escolher stack — **Node.js + TypeScript (NestJS)**, Postgres como banco primário
- [x] Setup de repositório, CI básico (lint + testes), ambientes (dev/staging/prod)
      — git inicializado, esqueleto NestJS, GitHub Actions (lint + build + test +
      e2e com Postgres em service container), `.env` para dev local e variáveis
      de ambiente reais para staging/prod
- [x] Decisão de auth: **provider próprio** (JWT + argon2/bcrypt), não
      terceirizado — mantém o modelo de `User`/`Membership` descrito em
      `arquitetura-dados.md` sob controle total do projeto (implementação em
      Fase 2)
- [x] Estratégia de migrations — **Prisma Migrate** (`schema.prisma` como fonte
      única do schema; RLS/triggers entram como SQL raw editado nas migrations
      geradas, já que Prisma não modela RLS nativamente)

## Fase 1 — Modelo de dados e multi-tenancy
- [ ] DDL de `Workspace`, `User`, `Membership`
- [ ] RLS no Postgres com `app.current_workspace_id` + testes que provam
      isolamento entre tenants (crítico: escrever teste que tenta vazar dado
      entre dois workspaces antes de seguir)
- [ ] DDL de `Company`, `Contact`, `Pipeline`, `Stage`, `Opportunity`, `Task`, `Activity`
- [ ] Seeds de desenvolvimento (workspace de teste com dados fake)

**Critério de saída:** consegue criar um workspace, um usuário, logar, e
inserir/consultar Company/Contact via query direta (sem API ainda) respeitando RLS.

## Fase 2 — Autenticação e autorização
- [ ] Login/signup, criação de workspace no signup
- [ ] Fluxo de convite de Membership (token, expiração, aceite)
- [ ] Módulo central de policy (`can(user, action, resource)`) cobrindo RBAC
      + ownership + hierarquia de time
- [ ] Testes de autorização por papel (owner/admin/manager/sales_rep/readonly)

**Critério de saída:** dois usuários em papéis diferentes no mesmo workspace
têm acesso de dados visivelmente distinto, validado por teste automatizado.

## Fase 3 — API core (CRUD + regras de negócio)
- [ ] Definir estilo de API (REST vs GraphQL) — decisão separada, não coberta
      no modelo de dados
- [ ] Endpoints de Company, Contact, Pipeline/Stage, Opportunity, Task
- [ ] Regras de negócio aplicadas na camada de serviço:
      - stage pertence ao pipeline da opportunity
      - `lost` exige `lost_reason`
      - toda mudança relevante gera Activity
      - versionamento otimista em Opportunity
- [ ] Soft delete + endpoint de restauração

**Critério de saída:** fluxo completo via API — criar company → contact →
opportunity → mover pelo pipeline → marcar como ganho/perdido — com Activity
sendo gerada automaticamente em cada passo.

## Fase 4 — Atividades, tarefas e auditoria
- [ ] Feed de Activity por Company/Contact/Opportunity (timeline)
- [ ] Tasks com `due_at`, atribuição, cálculo de overdue
- [ ] Notificações básicas (task vencendo, deal parado há N dias no mesmo stage)

**Critério de saída:** um usuário consegue abrir uma Opportunity e ver
histórico completo de interações + tarefas pendentes, sem consulta manual ao banco.

## Fase 5 — Relatórios e forecast
- [ ] Funil por pipeline/stage (contagem e valor)
- [ ] Forecast ponderado por `probability` do stage
- [ ] Performance por owner/time (usando hierarquia de Membership)
- [ ] Conversão multi-moeda em relatórios (moeda-base do workspace)

**Critério de saída:** dashboard (ainda que simples) respondendo "quanto está
no funil, por estágio, por responsável, em moeda-base".

## Fase 6 — Interface (frontend)
> Deliberadamente depois do backend estar sólido — decisão tomada no início
> da conversa: modelo, permissões e regras antes de qualquer tela.
- [ ] Definir stack de frontend
- [ ] Telas: pipeline Kanban, lista de contacts/companies, detalhe de
      opportunity com timeline, gestão de workspace/membros
- [ ] Testar papéis diferentes na UI (não só na API)

## Fase 7 — Integrações e extensibilidade
- [ ] Import/export (CSV, e futuramente integrações de e-mail/calendário)
- [ ] Webhooks de eventos (`opportunity.won`, `stage.changed`, etc.) —
      naturalmente alimentados pela tabela Activity
- [ ] API pública / chaves de API por workspace

## Fase 8 — Hardening para produção
- [ ] Rate limiting por workspace
- [ ] Plano de backup/restore testado (incluindo restore seletivo por tenant)
- [ ] Observabilidade (logs estruturados com `workspace_id`, métricas, tracing)
- [ ] Revisão de segurança (RLS sob carga, testes de vazamento entre tenants
      em escala, revisão de todas as queries que ignoram RLS — ex. jobs
      administrativos)
- [ ] Plano de migração para banco dedicado (tenant enterprise), caso necessário

---

## Ordem de dependência crítica

```
Fase 0 → Fase 1 (dados + RLS) → Fase 2 (auth/policy) → Fase 3 (API + regras)
                                                              │
                                        ┌─────────────────────┴───────┐
                                  Fase 4 (activity/task)        Fase 5 (relatórios)
                                                │
                                        Fase 6 (frontend) → Fase 7 (integrações) → Fase 8 (produção)
```

Fases 4 e 5 podem correr em paralelo depois da Fase 3. Fase 6 não deveria
começar antes da Fase 3 estar estável — mudar o modelo de dados depois que a
UI existe é o retrabalho mais caro do projeto.
