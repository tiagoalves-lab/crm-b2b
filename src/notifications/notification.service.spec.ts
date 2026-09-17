import { ConfigService } from '@nestjs/config';
import type { MailService } from '../mail/mail.service';
import type { SupabaseUserService } from '../memberships/supabase-user.service';
import type { TenantContextService } from '../tenancy/tenant-context.service';
import { NotificationService } from './notification.service';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const AUTOR = 'user-autor';
const DESTINO = 'user-destino';

const AMBIENTE: Record<string, unknown> = {
  reportTz: 'America/Sao_Paulo',
  reportAppUrl: 'https://crm.exemplo.com.br',
};

const IDENTIDADES = new Map([
  [AUTOR, { login: 'joao', name: 'João', email: 'joao@exemplo.com.br' }],
  [DESTINO, { login: 'maria', name: 'Maria', email: 'maria@exemplo.com.br' }],
]);

const TAREFA = {
  id: 'task-1',
  title: 'Enviar proposta revisada',
  description: null,
  dueAt: null,
  tipo: 'proposta',
  assigneeUserId: DESTINO,
  company: {
    id: 'company-1',
    fantasia: 'Metalúrgica Exemplo',
    razaoSocial: null,
    nomeParaContato: null,
    deletedAt: null,
  },
  opportunity: null,
};

const COMENTARIO = {
  id: 'comment-1',
  body: 'Confirmar o prazo com a produção antes de reenviar.',
  authorUserId: AUTOR,
  externalAuthor: null,
  mentionedUserIds: [DESTINO],
  opportunity: {
    id: 'opp-1',
    company: {
      id: 'company-1',
      fantasia: 'Metalúrgica Exemplo',
      razaoSocial: null,
      nomeParaContato: null,
      deletedAt: null,
    },
  },
};

interface Deps {
  tenantContext: { run: jest.Mock };
  mail: { configurado: boolean; send: jest.Mock };
  supabaseUsers: { getIdentities: jest.Mock };
  tx: {
    task: { findUnique: jest.Mock };
    opportunityComment: { findUnique: jest.Mock };
  };
}

function montar(overrides: {
  tarefa?: unknown;
  comentario?: unknown;
  identidades?: Map<string, unknown>;
} = {}): { service: NotificationService; deps: Deps } {
  const tx: Deps['tx'] = {
    task: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          'tarefa' in overrides ? overrides.tarefa : TAREFA,
        ),
    },
    opportunityComment: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          'comentario' in overrides ? overrides.comentario : COMENTARIO,
        ),
    },
  };

  const deps: Deps = {
    tenantContext: {
      run: jest.fn((_ctx: unknown, fn: (tx: Deps['tx']) => unknown) => fn(tx)),
    },
    mail: {
      configurado: true,
      send: jest.fn().mockResolvedValue({ ok: true, id: 'msg-1' }),
    },
    supabaseUsers: {
      getIdentities: jest
        .fn()
        .mockResolvedValue(overrides.identidades ?? IDENTIDADES),
    },
    tx,
  };

  const config = {
    get: jest.fn((chave: string) => AMBIENTE[chave]),
  } as unknown as ConfigService;

  const service = new NotificationService(
    deps.tenantContext as unknown as TenantContextService,
    deps.mail as unknown as MailService,
    deps.supabaseUsers as unknown as SupabaseUserService,
    config,
  );
  return { service, deps };
}

// O envio é adiado de propósito (setImmediate) pra não segurar a
// transação nem a resposta da requisição — o teste precisa deixar a fila
// de eventos girar antes de conferir.
async function deixarEnviar(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('NotificationService', () => {
  describe('tarefa designada', () => {
    it('avisa quem recebeu a tarefa', async () => {
      const { service, deps } = montar();

      service.avisarTarefaAtribuida({
        workspaceId: WORKSPACE_ID,
        taskId: 'task-1',
        assigneeUserId: DESTINO,
        actorUserId: AUTOR,
      });
      await deixarEnviar();

      expect(deps.mail.send).toHaveBeenCalledTimes(1);
      const [params] = deps.mail.send.mock.calls[0] as [
        { to: string[]; subject: string; html: string },
      ];
      expect(params.to).toEqual(['maria@exemplo.com.br']);
      expect(params.subject).toContain('Enviar proposta revisada');
      expect(params.html).toContain('Metalúrgica Exemplo');
      expect(params.html).toContain('João');
    });

    it('não avisa quem criou a tarefa para si mesmo', async () => {
      const { service, deps } = montar();

      service.avisarTarefaAtribuida({
        workspaceId: WORKSPACE_ID,
        taskId: 'task-1',
        assigneeUserId: AUTOR,
        actorUserId: AUTOR,
      });
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
      expect(deps.tenantContext.run).not.toHaveBeenCalled();
    });

    it('não avisa se a tarefa sumiu (transação revertida)', async () => {
      const { service, deps } = montar({ tarefa: null });

      service.avisarTarefaAtribuida({
        workspaceId: WORKSPACE_ID,
        taskId: 'task-1',
        assigneeUserId: DESTINO,
        actorUserId: AUTOR,
      });
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
    });

    it('não avisa se o responsável já foi trocado de novo', async () => {
      const { service, deps } = montar({
        tarefa: { ...TAREFA, assigneeUserId: 'outra-pessoa' },
      });

      service.avisarTarefaAtribuida({
        workspaceId: WORKSPACE_ID,
        taskId: 'task-1',
        assigneeUserId: DESTINO,
        actorUserId: AUTOR,
      });
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
    });

    it('não envia para quem não tem e-mail de contato cadastrado', async () => {
      const { service, deps } = montar({
        identidades: new Map([
          [AUTOR, { login: 'joao', name: 'João', email: null }],
          [DESTINO, { login: 'maria', name: 'Maria', email: null }],
        ]),
      });

      service.avisarTarefaAtribuida({
        workspaceId: WORKSPACE_ID,
        taskId: 'task-1',
        assigneeUserId: DESTINO,
        actorUserId: AUTOR,
      });
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
    });
  });

  describe('membro destacado', () => {
    it('avisa cada destacado separadamente, com o texto da anotação', async () => {
      const outro = 'user-outro';
      const { service, deps } = montar({
        comentario: { ...COMENTARIO, mentionedUserIds: [DESTINO, outro] },
        identidades: new Map([
          [AUTOR, { login: 'joao', name: 'João', email: 'joao@exemplo.com.br' }],
          [
            DESTINO,
            { login: 'maria', name: 'Maria', email: 'maria@exemplo.com.br' },
          ],
          [
            outro,
            { login: 'ana', name: 'Ana', email: 'ana@exemplo.com.br' },
          ],
        ]),
      });

      service.avisarMencao({
        workspaceId: WORKSPACE_ID,
        commentId: 'comment-1',
        userIds: [DESTINO, outro],
        actorUserId: AUTOR,
      });
      await deixarEnviar();

      // Um e-mail por pessoa: ninguém vê o endereço do colega.
      expect(deps.mail.send).toHaveBeenCalledTimes(2);
      const [primeiro] = deps.mail.send.mock.calls[0] as [
        { to: string[]; subject: string; html: string },
      ];
      expect(primeiro.to).toEqual(['maria@exemplo.com.br']);
      expect(primeiro.subject).toContain('João');
      expect(primeiro.html).toContain('Confirmar o prazo com a produção');
    });

    it('não avisa quem se destacou sozinho', async () => {
      const { service, deps } = montar();

      service.avisarMencao({
        workspaceId: WORKSPACE_ID,
        commentId: 'comment-1',
        userIds: [AUTOR],
        actorUserId: AUTOR,
      });
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
    });

    it('ignora quem não consta mais como destacado na anotação gravada', async () => {
      const { service, deps } = montar({
        comentario: { ...COMENTARIO, mentionedUserIds: [] },
      });

      service.avisarMencao({
        workspaceId: WORKSPACE_ID,
        commentId: 'comment-1',
        userIds: [DESTINO],
        actorUserId: AUTOR,
      });
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
    });
  });

  it('não tenta nada quando o envio de e-mail não está configurado', async () => {
    const { service, deps } = montar();
    deps.mail.configurado = false;

    service.avisarTarefaAtribuida({
      workspaceId: WORKSPACE_ID,
      taskId: 'task-1',
      assigneeUserId: DESTINO,
      actorUserId: AUTOR,
    });
    await deixarEnviar();

    expect(deps.tenantContext.run).not.toHaveBeenCalled();
    expect(deps.mail.send).not.toHaveBeenCalled();
  });

  it('falha de envio não vira exceção para quem salvou', async () => {
    const { service, deps } = montar();
    deps.mail.send.mockRejectedValue(new Error('provedor fora'));

    expect(() =>
      service.avisarTarefaAtribuida({
        workspaceId: WORKSPACE_ID,
        taskId: 'task-1',
        assigneeUserId: DESTINO,
        actorUserId: AUTOR,
      }),
    ).not.toThrow();
    await deixarEnviar();
  });
});
