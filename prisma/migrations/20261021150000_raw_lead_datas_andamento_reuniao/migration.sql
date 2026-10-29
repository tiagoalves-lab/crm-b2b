-- Datas de passagem por Andamento e Reunião (2026-10-21).
--
-- Motivo: o usuário leu no funil do Painel "1.347 entraram, 585 saíram" em
-- Prospectar/Entrada e "0,0% avançou", com 917 empresas em Andamento. As
-- duas faixas do meio só tinham estoque: sem data de passagem, o funil não
-- sabia contar quem avançou no período, e jogava todo descarte na primeira
-- faixa.
--
-- NULL = passagem anterior a este registro, ou que não aconteceu. Vale a
-- PRIMEIRA entrada na faixa: puxar o cartão de volta e avançar de novo não
-- reescreve a série (mesmo critério de qualified_at).
--
-- Sem policy nova: são colunas em tabela que já tem RLS por workspace.
ALTER TABLE "raw_leads"
  ADD COLUMN IF NOT EXISTS "andamento_at" timestamp,
  ADD COLUMN IF NOT EXISTS "reuniao_at"   timestamp;

-- Backfill do que é rastreável, só pra lead que de fato chegou à faixa
-- (etapa atual, ou a etapa em que parou quando descartado, igual ou além
-- dela) e só com fato registrado enquanto ele estava na triagem (entre a
-- criação e a conversão/descarte; conversão ou descarte antigo, sem data,
-- não tem limite conhecido e fica de fora). Nada de data inventada: lead
-- sem registro fica NULL.
--
-- Andamento: primeiro contato registrado à mão na Timeline — a mesma régua
-- que empurra o cartão (etapa-funil.ts). Fica de fora a anotação automática
-- do lead do Meta (payload.origem), que nasce junto com o lead e não é
-- contato do SDR.
UPDATE "raw_leads" rl
   SET "andamento_at" = ev.quando
  FROM (
    SELECT r.id,
           MIN(a.occurred_at) AS quando
      FROM "raw_leads" r
      JOIN "activities" a ON a.company_id = r.promoted_company_id
     WHERE r.etapa IN ('andamento', 'reuniao', 'qualificado', 'negociacao')
       AND a.type = 'note'
       AND a.payload->>'subtipo' IN ('nota', 'ligacao', 'visita', 'email', 'reuniao')
       AND a.payload->>'origem' IS NULL
       AND a.occurred_at >= r.created_at
       AND a.occurred_at <= CASE r.status WHEN 'novo' THEN now()
                                          WHEN 'aprovado' THEN r.converted_at
                                          ELSE r.discarded_at END
     GROUP BY r.id
  ) ev
 WHERE rl.id = ev.id
   AND rl."andamento_at" IS NULL;

-- Reunião: primeira reunião registrada na Timeline ou primeira tarefa do
-- tipo reunião criada pra empresa ("reunião marcada ou realizada").
UPDATE "raw_leads" rl
   SET "reuniao_at" = ev.quando
  FROM (
    SELECT r.id,
           MIN(f.quando) AS quando
      FROM "raw_leads" r
      JOIN (
        SELECT a.company_id, a.occurred_at AS quando
          FROM "activities" a
         WHERE a.type = 'note'
           AND a.payload->>'subtipo' = 'reuniao'
        UNION ALL
        SELECT t.company_id, t.created_at AS quando
          FROM "tasks" t
         WHERE t.tipo = 'reuniao'
      ) f ON f.company_id = r.promoted_company_id
     WHERE r.etapa IN ('reuniao', 'qualificado', 'negociacao')
       AND f.quando >= r.created_at
       AND f.quando <= CASE r.status WHEN 'novo' THEN now()
                                     WHEN 'aprovado' THEN r.converted_at
                                     ELSE r.discarded_at END
     GROUP BY r.id
  ) ev
 WHERE rl.id = ev.id
   AND rl."reuniao_at" IS NULL;

CREATE INDEX IF NOT EXISTS "raw_leads_workspace_andamento_at_idx"
  ON "raw_leads" ("workspace_id", "andamento_at");
CREATE INDEX IF NOT EXISTS "raw_leads_workspace_reuniao_at_idx"
  ON "raw_leads" ("workspace_id", "reuniao_at");
