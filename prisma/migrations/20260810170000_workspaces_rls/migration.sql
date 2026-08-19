-- Fecha o achado do advisor de segurança do Supabase: "workspaces" era a
-- única tabela do schema public sem RLS. Documentado desde a Fase 1
-- (ver bloco perto da linha 377 de prisma/schema.sql) que ela ficou de
-- fora de propósito porque não se encaixa no padrão
-- "workspace_id = variável de sessão" usado nas outras tabelas — ela não
-- tem coluna workspace_id, ela É o tenant.
--
-- O motivo real de nunca ter policy aqui: TenantMembershipGuard resolve
-- o workspace (upsert por slug fixo, ver
-- src/tenancy/tenant-membership.guard.ts#resolveDefaultWorkspace) ANTES
-- de abrir a transação que seta app.current_workspace_id — é o próprio
-- upsert que descobre o id que viraria essa variável. Uma policy no
-- padrão "id = current_setting(...)" quebraria esse upsert (galinha e
-- ovo: sem variável setada, current_setting(...) volta NULL, e
-- NULL = qualquer coisa nunca é verdadeiro → fail-closed bloqueando o
-- próprio login).
--
-- O que o advisor está de fato sinalizando é outro: sem RLS, as roles
-- anon/authenticated do Supabase (as que o cliente JS usa com a anon
-- key, pública por design — ver docs/seguranca.md) enxergam a tabela
-- inteira por padrão. O app nunca fala com o Postgres usando essas
-- roles (só o backend, pela role app_runtime, e só pra Auth do lado do
-- Supabase), mas a defesa tem que estar no banco, não em "o frontend
-- não faz isso hoje".
--
-- Fix: RLS ligado, mas com uma única policy liberando tudo pra
-- app_runtime (a role de execução do backend — já tem os GRANTs de
-- SELECT/INSERT/UPDATE/DELETE aplicados desde a Fase 1) e nada pra mais
-- ninguém. Não usa o padrão workspace_id = sessão porque não se aplica
-- aqui; quem decide QUAL workspace um usuário vê continua sendo
-- Membership + PolicyService, na camada de aplicação (só existe 1
-- workspace de verdade em uso, "gama").
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;

CREATE POLICY "app_runtime_only" ON "workspaces"
  FOR ALL
  TO "app_runtime"
  USING (true)
  WITH CHECK (true);
