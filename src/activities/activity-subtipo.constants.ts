// Subtipos (payload.subtipo, texto livre — não é enum do banco, ver
// CreateActivityDto) que exigem um contato da empresa/oportunidade
// vinculada (pedido direto do usuário, 2026-08-05, fora do
// SPEC-CRM-GAMA.md original) — mesma lista de CONTACT_REQUIRED_TASK_TYPES
// (src/tasks/task-type.constants.ts), replicada aqui porque Activity não
// compartilha o enum de Task: subtipo é string livre (o vocabulário do
// protótipo, ver ActivityService), Task.tipo é enum Postgres.
export const CONTACT_REQUIRED_ACTIVITY_SUBTIPOS = [
  'ligacao',
  'reuniao',
  'visita',
  'email',
];
