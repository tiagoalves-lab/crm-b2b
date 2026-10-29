-- Console fiscal (2026-10-20) — coluna "exige retorno" na tabela de CFOP,
-- pedida pelo usuário: separa a remessa que precisa voltar (demonstração,
-- conserto, comodato...) da que não volta (entrega futura, bonificação,
-- amostra grátis). É o filtro do controle de pendência remessa × retorno.
-- A tabela é editável direto no Supabase, então o CHECK impede marcar
-- "exige retorno" num CFOP que não é remessa.

ALTER TABLE "fiscal_cfop" ADD COLUMN "exige_retorno" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "fiscal_cfop" ADD CONSTRAINT "fiscal_cfop_exige_retorno_so_remessa"
  CHECK (NOT "exige_retorno" OR "remessa");
