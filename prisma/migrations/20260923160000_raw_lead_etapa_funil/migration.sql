-- Etapas do funil de prospecção (2026-09-23).
--
-- Pedido do usuário: "reestruturar as etapas do funil — Prospectar/Entrada
-- > Andamento > Reunião > Qualificado > Negociação/Fechamento".
--
-- Até aqui a faixa do lead era DERIVADA de status + manual_tier, e por
-- isso só conseguia representar três degraus (prospect / qualificado /
-- convertido). Faltava exatamente o meio do trabalho do SDR — "já falei
-- com a empresa" e "tem reunião marcada" —, que é o que o quadro Kanban
-- da Prospecção precisa ter como coluna pra poder arrastar o cartão.
--
-- Descartado continua em `status`: não é etapa do funil, tem aba própria,
-- e o lead descartado guarda a etapa em que parou.
--
-- Sem policy nova: coluna em tabela que já tem RLS por workspace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RawLeadEtapa') THEN
    CREATE TYPE "RawLeadEtapa" AS ENUM (
      'entrada', 'andamento', 'reuniao', 'qualificado', 'negociacao'
    );
  END IF;
END $$;

ALTER TABLE "raw_leads"
  ADD COLUMN IF NOT EXISTS "etapa" "RawLeadEtapa" NOT NULL DEFAULT 'entrada';

-- Backfill: cada lead começa na etapa equivalente à faixa em que a régua
-- antiga já o colocava, pra ninguém abrir o quadro e ver a base inteira
-- amontoada na primeira coluna.
--   convertido (status aprovado) → Negociação/Fechamento
--   com prazo de investimento    → Qualificado
--   o resto                      → Prospectar/Entrada (o default)
UPDATE "raw_leads" SET "etapa" = 'negociacao' WHERE "status" = 'aprovado';
UPDATE "raw_leads" SET "etapa" = 'qualificado'
 WHERE "status" <> 'aprovado' AND "manual_tier" IS NOT NULL;

-- Lead que já tem interação registrada na ficha não é mais "fila parada":
-- sobe pra Andamento, e pra Reunião se o registro foi de reunião. Mesma
-- régua que passa a valer daqui pra frente (ActivityService.createManual).
UPDATE "raw_leads" rl
   SET "etapa" = 'andamento'
  FROM (
    SELECT DISTINCT a.company_id
      FROM "activities" a
     WHERE a.company_id IS NOT NULL
       AND a.payload->>'subtipo' IN ('nota', 'ligacao', 'visita', 'email')
  ) ia
 WHERE rl.promoted_company_id = ia.company_id
   AND rl."etapa" = 'entrada';

UPDATE "raw_leads" rl
   SET "etapa" = 'reuniao'
  FROM (
    SELECT DISTINCT a.company_id
      FROM "activities" a
     WHERE a.company_id IS NOT NULL
       AND a.payload->>'subtipo' = 'reuniao'
  ) re
 WHERE rl.promoted_company_id = re.company_id
   AND rl."etapa" IN ('entrada', 'andamento');

CREATE INDEX IF NOT EXISTS "raw_leads_workspace_etapa_idx"
  ON "raw_leads" ("workspace_id", "etapa");
