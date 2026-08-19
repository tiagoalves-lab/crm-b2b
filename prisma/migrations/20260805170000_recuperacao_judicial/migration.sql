-- Indicativo "EM RECUPERAÇÃO JUDICIAL" da Receita Federal, extraído da
-- razão social pra um campo próprio (pedido direto do usuário,
-- 2026-08-05) — ver src/common/sanitize-razao-social.ts. Sem isso o
-- aviso passava despercebido dentro do texto corrido do nome da empresa
-- em qualquer tela/lista/proposta comercial.
--
-- Backfill: dado real já importado (149 empresas do crawler CNPJ, mais
-- qualquer empresa cadastrada por busca de CNPJ) pode já ter esse
-- indicativo dentro do razao_social/razaoSocial existente — a migration
-- também limpa quem já está no banco, não só o que entrar daqui pra
-- frente.

ALTER TABLE "companies" ADD COLUMN "em_recuperacao_judicial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "raw_leads" ADD COLUMN "em_recuperacao_judicial" BOOLEAN NOT NULL DEFAULT false;

UPDATE "companies"
SET "em_recuperacao_judicial" = true,
    "razao_social" = trim(regexp_replace(
      "razao_social",
      '[\s,;:()-]*EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL\)?[\s,;:()-]*$',
      '',
      'i'
    ))
WHERE "razao_social" ~* 'EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL';

UPDATE "raw_leads"
SET "em_recuperacao_judicial" = true,
    "razao_social" = trim(regexp_replace(
      "razao_social",
      '[\s,;:()-]*EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL\)?[\s,;:()-]*$',
      '',
      'i'
    ))
WHERE "razao_social" ~* 'EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL';
