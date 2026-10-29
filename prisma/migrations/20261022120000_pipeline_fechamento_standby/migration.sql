-- Pipeline: "Negociação e Fechamento" vira duas listas e a oportunidade
-- ganha o Stand by (pedido do usuário, 2026-10-22).
--
-- 1. A etapa nova "Fechamento" entra logo depois da que existia, que passa
--    a se chamar "Negociação". Os cards que estavam lá ficam em
--    Negociação — ninguém é movido sozinho.
INSERT INTO "stages" ("pipeline_id", "name", "order", "probability")
SELECT s."pipeline_id", 'Fechamento', s."order" + 1, 90
  FROM "stages" s
 WHERE s."name" = 'Negociação e Fechamento'
   AND NOT EXISTS (
     SELECT 1 FROM "stages" f
      WHERE f."pipeline_id" = s."pipeline_id" AND f."name" = 'Fechamento'
   );

UPDATE "stages" SET "name" = 'Negociação' WHERE "name" = 'Negociação e Fechamento';

-- 2. Stand by: o cliente avaliou e vai retomar mais adiante. A
--    oportunidade continua aberta (status open), sai do quadro e volta a
--    aparecer pela previsão de fechamento no calendário. NULL = ativa.
ALTER TABLE "opportunities" ADD COLUMN "standby_at" TIMESTAMP(3);
