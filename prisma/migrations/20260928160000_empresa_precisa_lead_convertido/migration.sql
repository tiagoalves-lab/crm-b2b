-- Empresa com oportunidade que nunca passou pela Prospecção (2026-09-28,
-- achado do usuário: "onde foi parar a empresa G8 Brindes?"). Cadastrada
-- direto no card de oportunidade ou pelo app de cotações, ela não era
-- cliente (não comprou) nem lead (não tinha raw_lead) — sumia das duas
-- telas. OpportunityService#create passa a criar o lead convertido que
-- falta; esta função diz se falta.
--
-- SECURITY DEFINER pelo mesmo motivo de find_company_id_by_cnpj: sob a
-- RLS do representante, o lead de outro dono e a venda/oportunidade ganha
-- de outro dono são invisíveis — a checagem comum daria falso "precisa" e
-- criaria lead duplicado ou lead pra cliente. Devolve só um booleano;
-- workspace_id segue obrigatório no filtro.
CREATE OR REPLACE FUNCTION public.empresa_precisa_lead_convertido(
  p_workspace_id uuid,
  p_company_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM "raw_leads"
      WHERE "workspace_id" = p_workspace_id
        AND "promoted_company_id" = p_company_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM "sales_history"
      WHERE "workspace_id" = p_workspace_id
        AND "company_id" = p_company_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM "opportunities"
      WHERE "workspace_id" = p_workspace_id
        AND "company_id" = p_company_id
        AND "status" = 'won'
    );
$$;

REVOKE ALL ON FUNCTION public.empresa_precisa_lead_convertido(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_precisa_lead_convertido(uuid, uuid) TO app_runtime;
