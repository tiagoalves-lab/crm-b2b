-- Console fiscal (2026-10-21) — a origem da nota passa a dizer DE QUAL
-- CONSULTA do eGestor ela veio, não só "eGestor": a origem é decidida pelo
-- endpoint, nunca pelo conteúdo da nota (docs/console-fiscal.md, decisões
-- 2.2 e 2.3). Com as notas recebidas chegando por outra consulta (e por
-- upload de XML), "egestor_api" deixaria de distinguir uma da outra.

ALTER TABLE "fiscal_nfe_emitida" ALTER COLUMN "origem" SET DEFAULT 'egestor:/v1/nfe';
ALTER TABLE "fiscal_nfse_emitida" ALTER COLUMN "origem" SET DEFAULT 'egestor:/v1/nfse';

UPDATE "fiscal_nfe_emitida"  SET "origem" = 'egestor:/v1/nfe'  WHERE "origem" = 'egestor_api';
UPDATE "fiscal_nfse_emitida" SET "origem" = 'egestor:/v1/nfse' WHERE "origem" = 'egestor_api';
