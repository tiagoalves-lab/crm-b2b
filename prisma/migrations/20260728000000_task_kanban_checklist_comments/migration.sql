-- Kanban de tarefas (colunas configuráveis, drag-and-drop) + cartão
-- completo (descrição, checklist, comentários) — pedido do usuário
-- 2026-07-28. Mesma forma de RLS que Pipeline/Stage: task_lists carrega
-- workspace_id direto (como pipelines); task_checklist_items e
-- task_comments não carregam workspace_id (como stages), isolamento via
-- subquery em task_id -> tasks.workspace_id.
--
-- Escrita manual (não gerada por `prisma migrate dev`): o shadow-database
-- diffing do Prisma pediu reset completo do banco real ao rodar
-- --create-only contra o Supabase de produção (provável falso positivo por
-- causa do RLS/CHECK adicionados via SQL raw em migrations anteriores,
-- fora do que o Prisma rastreia nativamente) — reset está fora de
-- cogitação com dado real em produção. Aplicado via `prisma migrate
-- deploy`, que não usa shadow database.

-- CreateTable
CREATE TABLE "task_lists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "is_done_list" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_lists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_lists_workspace_id_idx" ON "task_lists"("workspace_id");

ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_lists" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "task_lists"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

-- AlterTable: tasks ganha list_id (coluna do Kanban), position (ordem
-- dentro da coluna) e description (corpo do cartão). list_id começa
-- nullable pra permitir o backfill abaixo antes do NOT NULL final.
ALTER TABLE "tasks" ADD COLUMN "list_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN "description" TEXT;

-- Backfill: cria 3 colunas padrão ("A fazer" / "Em andamento" /
-- "Concluída", a última com is_done_list=true) pra cada workspace que já
-- tem alguma task, e associa cada task existente pelo status atual
-- (pending -> "A fazer", done -> "Concluída"). Workspaces sem task
-- nenhuma ainda não ganham lista aqui — o backend faz bootstrap
-- preguiçoso (mesmo padrão do TenantMembershipGuard) na primeira leitura
-- do Kanban.
INSERT INTO "task_lists" ("id", "workspace_id", "name", "order", "is_done_list")
SELECT gen_random_uuid(), w."workspace_id", l."name", l."order", l."is_done_list"
FROM (SELECT DISTINCT "workspace_id" FROM "tasks") w
CROSS JOIN (VALUES
  ('A fazer', 0, false),
  ('Em andamento', 1, false),
  ('Concluída', 2, true)
) AS l("name", "order", "is_done_list");

UPDATE "tasks" t
SET "list_id" = tl."id"
FROM "task_lists" tl
WHERE tl."workspace_id" = t."workspace_id"
  AND (
    (t."status" = 'done' AND tl."is_done_list" = true)
    OR (t."status" = 'pending' AND tl."order" = 0)
  );

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "list_id" ORDER BY "created_at") - 1 AS rn
  FROM "tasks"
)
UPDATE "tasks" t SET "position" = ranked.rn
FROM ranked WHERE ranked."id" = t."id";

ALTER TABLE "tasks" ALTER COLUMN "list_id" SET NOT NULL;

CREATE INDEX "tasks_list_id_idx" ON "tasks"("list_id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "task_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_checklist_items_task_id_idx" ON "task_checklist_items"("task_id");

ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- task_checklist_items não carrega workspace_id (como stages) —
-- isolamento via subquery em task_id -> tasks.workspace_id.
ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_checklist_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "task_checklist_items"
  USING (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  );

-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_comments_task_id_idx" ON "task_comments"("task_id");

ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "task_comments"
  USING (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  );
