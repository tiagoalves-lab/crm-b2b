-- Origem da oportunidade (2026-09-18).
--
-- NULL = nasceu no CRM, no ciclo comercial corrente.
-- 'historico-cotacoes' = carga das 123 cotações de jul-set/2025 feita por
-- scripts/importar-cotacoes-historico.ts. Elas nunca passaram pela jornada
-- do lead (Prospecção -> qualificação -> proposta), então contá-las no
-- funil do Painel produzia números sem nexo: 26 leads convertidos
-- "gerando" 124 negócios fechados. Com a marca, o funil olha só o ciclo
-- corrente e o histórico segue inteiro no Pipeline e nos relatórios.
--
-- Sem policy nova: é coluna em tabela que já tem RLS por workspace.
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "origem" text;

-- Backfill: as oportunidades da carga têm descrição no formato
-- "Cotação N de DD/MM/AAAA — item. Importada da planilha de cotações
-- (histórico de jul a set/2025)." — marca deixada pelo script de import.
UPDATE "opportunities"
   SET "origem" = 'historico-cotacoes'
 WHERE "origem" IS NULL
   AND "description" LIKE 'Cotação %'
   AND "description" LIKE '%Importada da planilha de cotações (histórico de jul a set/2025).%';
