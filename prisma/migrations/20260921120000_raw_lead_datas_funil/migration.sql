-- Datas de passagem de faixa do funil (2026-09-21).
--
-- Motivo: o funil do Painel só sabia contar estoque acumulado ("1.075 na
-- fila, 31 convertidos"), e a taxa de conversão dividia os ganhos pelo
-- total de leads de todos os tempos — métrica que cai sozinha a cada lead
-- importado. Sem data de passagem não existe funil por período.
--
-- NULL = passagem anterior a este registro, ou que não aconteceu. O funil
-- trata o passado sem data como uma linha só, "antes do registro".
--
-- Sem policy nova: são colunas em tabela que já tem RLS por workspace.
ALTER TABLE "raw_leads"
  ADD COLUMN IF NOT EXISTS "qualified_at"  timestamp,
  ADD COLUMN IF NOT EXISTS "converted_at"  timestamp,
  ADD COLUMN IF NOT EXISTS "discarded_at"  timestamp;

-- Backfill do que é rastreável: a conversão passou a emitir Activity
-- (payload.action = 'lead_approved') em 2026-08-20, então dá pra recuperar
-- a data das conversões feitas desde então. O resto fica NULL de
-- propósito: inventar data falsearia a série histórica.
UPDATE "raw_leads" rl
   SET "converted_at" = ev.quando
  FROM (
    SELECT a.company_id,
           MIN(a.occurred_at) AS quando
      FROM "activities" a
     WHERE a.payload->>'action' = 'lead_approved'
       AND a.company_id IS NOT NULL
     GROUP BY a.company_id
  ) ev
 WHERE rl.promoted_company_id = ev.company_id
   AND rl.status = 'aprovado'
   AND rl."converted_at" IS NULL;

-- Índices das duas leituras do funil por período.
CREATE INDEX IF NOT EXISTS "raw_leads_workspace_converted_at_idx"
  ON "raw_leads" ("workspace_id", "converted_at");
CREATE INDEX IF NOT EXISTS "raw_leads_workspace_qualified_at_idx"
  ON "raw_leads" ("workspace_id", "qualified_at");
