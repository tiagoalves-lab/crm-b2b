-- Padroniza em caixa alta os campos de texto de cadastro das empresas de
-- prospecção: raw_leads (tela Prospecção) + companies vinculadas a esses
-- leads (via raw_leads.promoted_company_id) — pedido do usuário,
-- 2026-08-10, parte do recurso de padronização de cadastro.
--
-- Fora do escopo (decisão confirmada com o usuário nesta mesma sessão):
--   - cnpj/cpf_cnpj, emails, fones, cep — dado técnico/identificador, não
--     texto de cadastro; email fica minúsculo por convenção.
--   - tags/socios (arrays) e domain (URL) — não entram nesta rodada.
--   - companies fora da Prospecção (cadastradas direto pelo menu
--     Empresas) — não tocadas aqui, só as vinculadas a um raw_lead.
--
-- Idempotente: pode rodar de novo sem efeito colateral (WHERE só pega
-- linha que ainda não está em caixa alta).

BEGIN;

UPDATE raw_leads
SET
  razao_social   = UPPER(razao_social),
  cnae_principal = UPPER(cnae_principal),
  cnae_descricao = UPPER(cnae_descricao),
  porte          = UPPER(porte),
  uf             = UPPER(uf),
  municipio      = UPPER(municipio),
  situacao       = UPPER(situacao),
  segmento       = UPPER(segmento)
WHERE
  razao_social   IS DISTINCT FROM UPPER(razao_social)
  OR cnae_principal IS DISTINCT FROM UPPER(cnae_principal)
  OR cnae_descricao IS DISTINCT FROM UPPER(cnae_descricao)
  OR porte          IS DISTINCT FROM UPPER(porte)
  OR uf             IS DISTINCT FROM UPPER(uf)
  OR municipio      IS DISTINCT FROM UPPER(municipio)
  OR situacao       IS DISTINCT FROM UPPER(situacao)
  OR segmento       IS DISTINCT FROM UPPER(segmento);

UPDATE companies
SET
  razao_social      = UPPER(razao_social),
  fantasia          = UPPER(fantasia),
  nome_para_contato = UPPER(nome_para_contato),
  industry          = UPPER(industry),
  size              = UPPER(size),
  logradouro        = UPPER(logradouro),
  numero            = UPPER(numero),
  complemento       = UPPER(complemento),
  bairro            = UPPER(bairro),
  cidade            = UPPER(cidade),
  uf                = UPPER(uf)
WHERE id IN (SELECT promoted_company_id FROM raw_leads WHERE promoted_company_id IS NOT NULL)
  AND (
    razao_social       IS DISTINCT FROM UPPER(razao_social)
    OR fantasia         IS DISTINCT FROM UPPER(fantasia)
    OR nome_para_contato IS DISTINCT FROM UPPER(nome_para_contato)
    OR industry         IS DISTINCT FROM UPPER(industry)
    OR size             IS DISTINCT FROM UPPER(size)
    OR logradouro       IS DISTINCT FROM UPPER(logradouro)
    OR numero           IS DISTINCT FROM UPPER(numero)
    OR complemento      IS DISTINCT FROM UPPER(complemento)
    OR bairro           IS DISTINCT FROM UPPER(bairro)
    OR cidade           IS DISTINCT FROM UPPER(cidade)
    OR uf               IS DISTINCT FROM UPPER(uf)
  );

COMMIT;
