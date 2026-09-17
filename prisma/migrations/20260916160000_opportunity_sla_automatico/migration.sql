-- SLA da proposta automático (pedido do usuário, 2026-09-16) — ver
-- src/opportunities/opportunity-sla.ts. O Prazo SLA deixa de ser digitado:
-- vazio enquanto a proposta está nas etapas de proposta (a conta corre até
-- hoje) e preenchido com o dia em que ela entrou em Negociação e
-- Fechamento. `sla_revision_date` guarda o reinício da contagem quando o
-- cliente pede alteração.
--
-- Sem RLS nova: coluna em tabela que já tem a policy de isolamento por
-- workspace. Escrita manual, aplicada via `prisma migrate deploy`.

ALTER TABLE "opportunities" ADD COLUMN "sla_revision_date" DATE;

-- Recalcula o que já existe, descartando as datas digitadas à mão.
-- 1) Em etapa de proposta e aberta: pendente.
-- 2) Fora das etapas de proposta: dia (Brasília) da última entrada na
--    etapa atual; sem registro de movimento, nasceu ali — dia da abertura.
-- 3) Encerrada ainda em etapa de proposta: dia do encerramento.
UPDATE "opportunities" o
SET "sla_due_date" = CASE
  WHEN s."name" IN ('Solicitação de Propostas', 'Elaboração de Propostas', 'Aprovação de Propostas') THEN
    CASE WHEN o."status" = 'open' THEN NULL
         ELSE (COALESCE(o."closed_at", o."updated_at") AT TIME ZONE 'America/Sao_Paulo')::date
    END
  ELSE COALESCE(
    (SELECT (MAX(a."occurred_at") AT TIME ZONE 'America/Sao_Paulo')::date
       FROM "activities" a
      WHERE a."opportunity_id" = o."id"
        AND a."type" = 'stage_change'
        AND a."payload"->>'toStageId' = o."stage_id"::text),
    (o."created_at" AT TIME ZONE 'America/Sao_Paulo')::date
  )
END
FROM "stages" s
WHERE s."id" = o."stage_id";
