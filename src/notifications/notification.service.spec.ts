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

const LEAD = {
  id: 'raw-lead-1',
  razaoSocial: 'METALÚRGICA EXEMPLO LTDA',
  cnpj: null,
  municipio: 'Caxias do Sul',
  uf: 'RS',
  ownerUserId: AUTOR,
  createdAt: new Date('2026-09-18T13:32:00.000Z'),
};

interface Deps {
  tenantContext: { run: jest.Mock };
  mail: { configurado: boolean; send: jest.Mock };
  supabaseUsers: { getIdentities: jest.Mock };
  reports: { membrosElegiveis: jest.Mock; emailsDe: jest.Mock };
  reportConfig: { obter: jest.Mock };
  tx: {
    task: { findUnique: jest.Mock };
    opportunityComment: { findUnique: jest.Mock };
    rawLead: { findUnique: jest.Mock };
    reportLog: { findUnique: jest.Mock; upsert: jest.Mock };
  };
}

function montar(overrides: {
  tarefa?: unknown;
  comentario?: unknown;
  lead?: unknown;
  identidades?: Map<string, unknown>;
  elegiveis?: string[];
  emailsDestino?: string[];
  avisoLeadAtivo?: boolean;
  jaAvisado?: unknown;
} = {}): { service: NotificationService; deps: Deps } {
  const tx: Deps['tx'] = {
    rawLead: {
      findUnique: jest
        .fn()
        .mockResolvedValue('lead' in overrides ? overrides.lead : LEAD),
    },
    reportLog: {
      findUnique: jest.fn().mockResolvedValue(overrides.jaAvisado ?? null),
      upsert: jest.fn().mockResolvedValue({}),
    },
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
    // Quem recebe o aviso de lead novo é a mesma lista dos reports — aqui
    // ela vem pronta, para o teste falar só do aviso.
    reports: {
      membrosElegiveis: jest
        .fn()
        .mockResolvedValue(overrides.elegiveis ?? ['user-gestor']),
      emailsDe: jest.fn().mockResolvedValue({
        emails: overrides.emailsDestino ?? ['gestor@gamabrasil.com.br'],
        semEmail: [],
      }),
    },
    reportConfig: {
      obter: jest.fn().mockResolvedValue({
        tipo: 'lead-meta',
        ativo: overrides.avisoLeadAtivo ?? true,
        horarios: [],
        diasUteis: false,
        etapas: [],
        destinatarios: [],
        atualizadoEm: null,
        atualizadoPor: null,
      }),
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
    deps.reports as never,
    deps.reportConfig as never,
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
  describe('lead novo do Meta', () => {
    const LEAD_PARAMS = {
      workspaceId: WORKSPACE_ID,
      rawLeadId: 'raw-lead-1',
      leadgenId: '9001',
      contato: {
        nome: 'JOANA PRADO',
        email: 'joana@exemplo.com.br',
        telefone: '(54) 99999-0000',
      },
      contexto: {
        plataforma: 'Instagram',
        campanha: 'Campanha de teste',
        formulario: 'Orçamento',
      },
      respostas: [
        { pergunta: 'Qual equipamento?', resposta: 'Talha elétrica' },
      ],
    };

    it('manda um e-mail só, com contato e respostas do formulário', async () => {
      const { service, deps } = montar();

      service.avisarLeadDoMeta(LEAD_PARAMS);
      await deixarEnviar();

      expect(deps.mail.send).toHaveBeenCalledTimes(1);
      const [params] = deps.mail.send.mock.calls[0] as [
        { to: string[]; subject: string; html: string; idempotencyKey?: string },
      ];
      expect(params.to).toEqual(['gestor@gamabrasil.com.br']);
      expect(params.subject).toContain('METALÚRGICA EXEMPLO LTDA');
      expect(params.subject).toContain('Instagram');
      expect(params.html).toContain('JOANA PRADO');
      expect(params.html).toContain('Talha elétrica');
      expect(params.html).toContain('Caxias do Sul/RS');
      // Trava do lado do provedor: o mesmo lead nunca gera dois e-mails.
      expect(params.idempotencyKey).toContain('9001');
    });

    it('registra o envio para a tela responder "saiu mesmo?"', async () => {
      const { service, deps } = montar();

      service.avisarLeadDoMeta(LEAD_PARAMS);
      await deixarEnviar();

      expect(deps.tx.reportLog.upsert).toHaveBeenCalledTimes(1);
      const [args] = deps.tx.reportLog.upsert.mock.calls[0] as [
        { create: { refDia: string; status: string; destinatarios: number } },
      ];
      expect(args.create.refDia).toBe('lead 9001');
      expect(args.create.status).toBe('enviado');
      expect(args.create.destinatarios).toBe(1);
    });

    it('não avisa com o aviso desligado na tela', async () => {
      const { service, deps } = montar({ avisoLeadAtivo: false });

      service.avisarLeadDoMeta(LEAD_PARAMS);
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
    });

    it('não avisa duas vezes o mesmo lead', async () => {
      const { service, deps } = montar({
        jaAvisado: { status: 'enviado' },
      });

      service.avisarLeadDoMeta(LEAD_PARAMS);
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
    });

    it('não avisa se o lead sumiu (transação revertida)', async () => {
      const { service, deps } = montar({ lead: null });

      service.avisarLeadDoMeta(LEAD_PARAMS);
      await deixarEnviar();

      expect(deps.mail.send).not.toHaveBeenCalled();
    });
  });

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
