-- Adiciona a tag "INTERMACH 2025" aos leads da última importação (feira
-- INTERMACH, 2026-08-10), que entraram sem tag por causa de um problema
-- na importação. Escopo: só leads 'novo' criados no dia da importação,
-- sem tag nenhuma ainda e sem a tag "Mercopar 2025" (pedido explícito do
-- usuário — não misturar com o lote de outra feira já tageado). Idempotente
-- (não duplica a tag se rodar de novo).
--
-- Conferido antes de rodar: 626 linhas batiam com o WHERE, batendo exato
-- com o total de leads sem tag criados em 2026-08-10 (sem sobreposição de
-- CNPJ com os 250 leads do Mercopar 2025, criados em 2026-08-06).

UPDATE raw_leads
SET tags = array_append(tags, 'INTERMACH 2025')
WHERE status = 'novo'
  AND created_at::date = '2026-08-10'
  AND NOT ('Mercopar 2025' = ANY(tags))
  AND NOT ('INTERMACH 2025' = ANY(tags));
