-- Papel de execução da aplicação — SEM superuser e SEM BYPASSRLS.
--
-- RLS não protege nada se a conexão usar um papel que ignora RLS: todo
-- superusuário do Postgres ignora RLS por padrão, e ignora até
-- FORCE ROW LEVEL SECURITY. A connection string padrão que o Supabase
-- fornece no painel normalmente usa o papel `postgres` (superuser) —
-- perfeita para rodar migrations, mas NUNCA deve ser o que a aplicação
-- usa em runtime. Ver docs/seguranca.md.
--
-- Este migration cria o papel e concede os privilégios necessários, mas
-- PROPOSITALMENTE não define senha nem faz LOGIN — isso é feito fora do
-- controle de versão, depois de aplicar este migration:
--
--   ALTER ROLE app_runtime WITH LOGIN PASSWORD '<senha forte gerada por você>';
--
-- A connection string resultante (com esse papel, não `postgres`) vai em
-- DATABASE_URL. DIRECT_URL continua com a connection string privilegiada
-- do Supabase, usada só por `prisma migrate`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- Tabelas criadas por migrations futuras também concedem automaticamente
-- pra esse papel, sem precisar lembrar de repetir o GRANT toda vez.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
