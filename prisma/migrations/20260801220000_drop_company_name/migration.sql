-- Decisão do usuário (2026-08-01): "name" era o único campo obrigatório
-- de Company desde sempre, mas ficou redundante depois que razão
-- social/fantasia passaram a existir (2026-07-28) — toda empresa
-- cadastrada por CNPJ preenche razão social automaticamente, e o
-- formulário seguia exigindo "Nome" à parte, gerando erro de validação
-- depois de uma busca de CNPJ (nenhum desses dois campos preenche
-- "name"). Removido de vez: exibição em toda a UI passa a derivar de
-- fantasia/razão social/nome pra contato na hora (ver
-- web/lib/api/companies.ts#companyDisplayName), não é mais coluna
-- própria.

-- ── Preserva dado existente. Descoberto ao investigar antes de rodar
-- (query manual contra o workspace "gama" real): não são só as ~4
-- empresas de exemplo — o workspace tem 250+ empresas reais, e na
-- maioria delas "name" é um apelido/nome fantasia curto DIFERENTE da
-- razão social já preenchida (ex.: name="COFELMA", razao_social=
-- "METALURGICA COFELMA LTDA") — provavelmente uma carga em lote feita
-- direto no banco, sem passar pelo formulário/busca de CNPJ que
-- preencheria "fantasia". A ordem de prioridade de companyDisplayName é
-- fantasia > razão social > nome pra contato — sem este primeiro UPDATE,
-- "fantasia" ficaria NULL pra quase todas e a exibição trocaria o
-- apelido curto pela razão social inteira em toda tela (Empresas,
-- Pipeline, Tarefas, seletor de empresa) pra 250+ registros reais.
-- Preenche fantasia com o valor antigo de "name" sempre que fantasia
-- ainda está vazia — reproduz exatamente o texto que já era exibido,
-- mesmo quando name == razao_social (não faz mal duplicar).
UPDATE "companies" SET "fantasia" = "name" WHERE "fantasia" IS NULL;

-- Cobre o caso inverso, raro mas possível (registro só com "name",
-- razão social nunca preenchida) — não é o caso comum deste workspace,
-- mas mantém company.razaoSocial como fallback de exibição funcionando
-- em qualquer registro futuro nessa situação.
UPDATE "companies" SET "razao_social" = "name" WHERE "razao_social" IS NULL;

-- ── v_busca_empresa_lead depende da coluna "name" — precisa parar de
-- referenciá-la ANTES do DROP COLUMN, senão o Postgres recusa
-- ("cannot drop column name ... other objects depend on it"). Mesma
-- ordem de prioridade do helper companyDisplayName do frontend
-- (fantasia > razão social > nome pra contato), com um fallback final
-- literal só pra nunca devolver NULL na coluna "nome" da view.
CREATE OR REPLACE VIEW "v_busca_empresa_lead" AS
  SELECT
    c."id"                              AS "id",
    'empresa'::text                     AS "origem",
    COALESCE(c."fantasia", c."razao_social", c."nome_para_contato", 'Empresa sem nome') AS "nome",
    c."cpf_cnpj"                        AS "cnpj",
    c."workspace_id"                    AS "workspace_id"
  FROM "companies" c
  WHERE c."deleted_at" IS NULL
    AND NOT (c."tags" @> ARRAY['lead-triagem'])
  UNION ALL
  SELECT
    r."id"            AS "id",
    'lead'::text       AS "origem",
    r."razao_social"   AS "nome",
    r."cnpj"           AS "cnpj",
    r."workspace_id"   AS "workspace_id"
  FROM "raw_leads" r
  WHERE r."status" = 'novo';

ALTER TABLE "companies" DROP COLUMN "name";
