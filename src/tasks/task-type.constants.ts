import type { TaskType } from '@prisma/client';

// 5 tipos do protótipo (gama-crm-mvp.html, openTaskForm) + "reuniao"
// adicionado depois (pedido direto do usuário, 2026-08-04).
export const TASK_TYPES: TaskType[] = [
  'ligacao',
  'email',
  'visita',
  'proposta',
  'followup',
  'reuniao',
];

// Tarefas desses tipos exigem um contato da empresa vinculada (pedido do
// usuário, 2026-08-04; "email" incluído depois, mesmo dia) — checado em
// TaskService, não dá pra expressar "obrigatório condicional ao valor de
// outro campo" só com decorators de DTO nem CHECK constraint de coluna.
export const CONTACT_REQUIRED_TASK_TYPES: TaskType[] = [
  'ligacao',
  'reuniao',
  'visita',
  'email',
];
