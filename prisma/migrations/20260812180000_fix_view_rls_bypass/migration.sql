-- ═══════════════════════════════════════════════════════════════════
-- Correção de vazamento de dados encontrado na auditoria de 2026-08-12
-- (docs/seguranca.md, decisões 3.4.1 e 3.4.2).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. v_busca_empresa_lead atravessava o RLS ──────────────────────
--
-- A view foi criada em 20260729000000_leads_and_task_attachments sem a
-- opção `security_invoker`. Em Postgres, view sem essa opção executa com
-- os privilégios do DONO dela — aqui `postgres`, que ignora RLS. Ou seja:
-- toda consulta à view lia companies/raw_leads SEM nenhuma policy
-- aplicada, independente de quem perguntasse.
--
-- Isso não era teórico. Medido em 2026-08-12, antes desta migration:
--   - papel `anon`   → 0 linhas em raw_leads (RLS negou corretamente),
--                      mas 1176 linhas na view (razão social + CNPJ de
--                      toda empresa e todo lead da base);
--   - papel `authenticated` → idêntico.
--
-- Agravante: o comentário em src/search/search.service.ts afirmava que a
-- view "já herda RLS das tabelas-base" e por isso dispensava filtro de
-- workspace. A premissa era falsa — o filtro nunca existiu de fato.
--
-- `security_invoker = true` faz a view rodar com o privilégio de QUEM
-- consulta, então as policies de companies/raw_leads voltam a valer.
-- Requer Postgres 15+ (este projeto roda 17.6).
ALTER VIEW public."v_busca_empresa_lead" SET (security_invoker = true);

-- ── 2. Nada em `public` precisa ser alcançável por anon/authenticated ─
--
-- O Supabase concede, por padrão, privilégio amplo em `public` pros
-- papéis `anon` e `authenticated` — são eles que o PostgREST (a API REST
-- automática, acessível do navegador com a chave pública) assume. Faz
-- sentido num app que fala direto com o Supabase pelo navegador.
--
-- **Não é o caso deste projeto.** Verificado em 2026-08-12: nenhum
-- componente instancia o client de navegador do Supabase
-- (web/lib/supabase/client.ts não é importado por ninguém), o login usa
-- Server Action, e todo acesso a dado passa pelo NestJS conectado como
-- `app_runtime`. Ou seja, o PostgREST é superfície de ataque 100%
-- desnecessária aqui — e era exatamente por onde a view vazava.
--
-- Seguro porque `app_runtime` NÃO é membro de `anon`/`authenticated`
-- (checado em pg_auth_members) e tem grants próprios nas 20 tabelas.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Sem isto, a próxima tabela criada nasceria exposta de novo — o REVOKE
-- acima só alcança o que já existe.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ── 3. find_company_id_by_cnpj: o REVOKE original não pegou ─────────
--
-- A migration 20260806190000 já fazia `REVOKE ALL ... FROM PUBLIC` e
-- concedia EXECUTE só pra app_runtime — a intenção estava certa. Mas o
-- privilégio de `anon`/`authenticated` não vem de PUBLIC: vem dos grants
-- default do Supabase, que são concedidos aos papéis nominalmente. O
-- REVOKE de PUBLIC não os alcançava, e a auditoria encontrou
-- `anon=X/postgres` no ACL da função.
--
-- Como ela é SECURITY DEFINER (atravessa RLS de propósito), anon poder
-- executá-la permitia testar se um CNPJ existe na base — enumeração.
-- O REVOKE ON ALL FUNCTIONS acima já resolve; o GRANT abaixo é só pra
-- deixar explícito e à prova de ordem de execução que app_runtime
-- mantém o acesso de que o CompanyService depende.
GRANT EXECUTE ON FUNCTION public.find_company_id_by_cnpj(uuid, text) TO app_runtime;
