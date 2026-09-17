import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { getReportConfig, type ReportConfig } from "@/lib/api/reports";
import { formatDateTimeBR } from "@/lib/format-date";
import {
  enviarAgoraAction,
  enviarTesteAction,
  salvarDestinatariosAction,
  salvarReportConfigAction,
} from "./actions";

// Tela "E-mail automático" (Administração, 2026-09-15) — configura os dois
// reports recorrentes: o resumo diário do Pipeline e o follow-up das
// cotações. Os avisos de tarefa designada e de destaque em anotação NÃO
// entram aqui de propósito: são reação a uma ação de alguém, não têm
// horário pra configurar (ver docs/reports-email.md).
//
// Formulário sem JavaScript no cliente, no mesmo padrão do resto do
// projeto: cada card é um <form> com Server Action, e a lista de horários
// é um campo por linha mais um vazio pra acrescentar — apagar o conteúdo
// da linha remove o horário.
//
// Só owner/admin. O nav já esconde o item pros demais papéis; o guard aqui
// é defesa em profundidade, mesmo padrão da Integração eGestor.
export default async function EmailAutomaticoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const me = await getMe(token);
  const canManage =
    me.membership.role === "owner" || me.membership.role === "admin";

  if (!canManage) {
    return (
      <div className="content">
        <div className="error-banner">
          Só owner/admin podem configurar os e-mails automáticos.
        </div>
      </div>
    );
  }

  const dados = await getReportConfig(token);
  const diario = dados.configs.find((c) => c.tipo === "pipeline-diario");
  const followup = dados.configs.find((c) => c.tipo === "pipeline-followup");
  const semEmail = dados.destinatarios.filter((d) => !d.email);

  return (
    <div className="content">
      <div className="panel-head">
        <h2>E-mail automático</h2>
        <div className="sub">
          Quando o CRM manda relatório por e-mail, para quem, e o que vai
          dentro.
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!dados.envioConfigurado && (
        <div className="error-banner">
          O envio de e-mail não está ligado no servidor. Enquanto isso,
          nenhum relatório sai — a configuração abaixo fica guardada e passa
          a valer assim que o envio for ligado.
        </div>
      )}

      {/* Resumo diário ------------------------------------------------ */}
      <ReportCard
        titulo="Resumo diário do Pipeline"
        descricao="Panorama do dia: o pipeline inteiro em tabela, os comentários fixados e as tarefas pendentes."
        config={diario}
        candidatos={dados.destinatarios}
        umHorarioSo
      />

      {/* Follow-up ---------------------------------------------------- */}
      <ReportCard
        titulo="Follow-up de cotações"
        descricao="Acompanhamento das cotações em aberto, ordenado da que está parada há mais tempo para a mais recente."
        config={followup}
        candidatos={dados.destinatarios}
        etapasDisponiveis={dados.etapasDisponiveis}
      />

      {semEmail.length > 0 && (
        <div className="field-hint" style={{ margin: "-8px 4px 20px" }}>
          {semEmail.length === 1
            ? "1 membro está sem e-mail cadastrado e não recebe nenhum relatório — dá para corrigir na tela de Membros."
            : `${semEmail.length} membros estão sem e-mail cadastrado e não recebem nenhum relatório — dá para corrigir na tela de Membros.`}
        </div>
      )}

      {/* Últimos envios ----------------------------------------------- */}
      <div className="form-panel">
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Últimos envios</h3>
        <div className="sub" style={{ marginBottom: 12 }}>
          Registro de cada disparo, com sucesso ou falha.
        </div>
        {dados.ultimosEnvios.length === 0 ? (
          <div className="empty-state">Nenhum envio registrado ainda.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Relatório</th>
                <th>Rodada</th>
                <th>Situação</th>
                <th style={{ textAlign: "right" }}>Destinatários</th>
              </tr>
            </thead>
            <tbody>
              {dados.ultimosEnvios.map((envio) => (
                <tr key={`${envio.tipo}-${envio.referencia}`}>
                  <td>{formatDateTimeBR(envio.criadoEm)}</td>
                  <td>
                    {envio.tipo === "pipeline-followup"
                      ? "Follow-up"
                      : "Resumo diário"}
                  </td>
                  <td>{envio.referencia}</td>
                  <td>
                    {envio.status === "enviado" ? (
                      <span className="badge">enviado</span>
                    ) : (
                      <span className="badge badge-danger" title={envio.erro ?? ""}>
                        falha
                      </span>
                    )}
                    {envio.erro && envio.status === "enviado" && (
                      <span className="sub"> · {envio.erro}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>{envio.destinatarios}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Card de um report: liga/desliga, horários, dias e (no follow-up) as
// etapas do Pipeline que entram na lista.
function ReportCard({
  titulo,
  descricao,
  config,
  candidatos,
  umHorarioSo = false,
  etapasDisponiveis,
}: {
  titulo: string;
  descricao: string;
  config: ReportConfig | undefined;
  candidatos: { userId: string; nome: string; email: string | null }[];
  umHorarioSo?: boolean;
  etapasDisponiveis?: string[];
}) {
  if (!config) return null;

  // Lista vazia no banco significa "todos" — então as caixinhas nascem
  // todas marcadas, que é o que está valendo de fato.
  const todosMarcados = config.destinatarios.length === 0;

  // Uma linha por horário salvo + uma vazia pra acrescentar (o resumo
  // diário tem um horário só, então não ganha linha extra).
  const linhas = umHorarioSo
    ? [config.horarios[0] ?? ""]
    : [...config.horarios, ""];

  return (
    <div className="form-panel">
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>{titulo}</h3>
      <div className="sub" style={{ marginBottom: 14 }}>{descricao}</div>

      <form action={salvarReportConfigAction}>
        <input type="hidden" name="tipo" value={config.tipo} />

        <div className="form-grid" style={{ marginBottom: 14 }}>
          {linhas.map((horario, indice) => (
            <label key={`${config.tipo}-h-${indice}`}>
              {umHorarioSo
                ? "Horário"
                : indice < config.horarios.length
                  ? `Horário ${indice + 1}`
                  : "Acrescentar horário"}
              <input type="time" name="horario" defaultValue={horario} />
            </label>
          ))}
        </div>

        {!umHorarioSo && (
          <div className="field-hint" style={{ marginBottom: 14 }}>
            Para remover um horário, apague o conteúdo do campo e salve.
          </div>
        )}

        {etapasDisponiveis && etapasDisponiveis.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 8,
              }}
            >
              Etapas que entram na lista
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
              {etapasDisponiveis.map((etapa) => (
                <label
                  key={etapa}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    name="etapa"
                    value={etapa}
                    defaultChecked={config.etapas.includes(etapa)}
                  />
                  {etapa}
                </label>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 18,
            marginBottom: 16,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" name="ativo" defaultChecked={config.ativo} />
            Ativo
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              name="diasUteis"
              defaultChecked={config.diasUteis}
            />
            Só em dias úteis
          </label>
          {config.atualizadoEm && (
            <span className="sub">
              Última alteração em {formatDateTimeBR(config.atualizadoEm)}
            </span>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-sm">
          Salvar
        </button>
      </form>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-end",
          marginTop: 16,
          paddingTop: 16,
          borderTop: "1px solid var(--border)",
        }}
      >
        <form action={enviarTesteAction} className="form-grid" style={{ flex: 1, minWidth: 260 }}>
          <input type="hidden" name="tipo" value={config.tipo} />
          <label>
            Enviar um teste para
            <input
              type="email"
              name="para"
              placeholder="voce@gamabrasil.com.br"
              required
            />
          </label>
          <button type="submit" className="btn btn-ghost btn-sm">
            Enviar teste
          </button>
        </form>

        <form action={enviarAgoraAction}>
          <input type="hidden" name="tipo" value={config.tipo} />
          <button type="submit" className="btn btn-ghost btn-sm">
            Enviar agora para todos
          </button>
        </form>
      </div>

      {/* Quem recebe ESTE relatório — cada um tem a sua lista. */}
      <form
        action={salvarDestinatariosAction}
        style={{
          marginTop: 16,
          paddingTop: 16,
          borderTop: "1px solid var(--border)",
        }}
      >
        <input type="hidden" name="tipo" value={config.tipo} />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 6,
          }}
        >
          Quem recebe
        </div>
        <div className="sub" style={{ marginBottom: 10 }}>
          Só aparecem aqui membros ativos que não são representantes. Quem
          está sem e-mail cadastrado não recebe, mesmo marcado.
        </div>

        {candidatos.length === 0 ? (
          <div className="empty-state">Nenhum membro elegível encontrado.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "6px 18px",
              marginBottom: 12,
            }}
          >
            {candidatos.map((candidato) => (
              <label
                key={`${config.tipo}-${candidato.userId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  name="destinatario"
                  value={candidato.userId}
                  defaultChecked={
                    todosMarcados ||
                    config.destinatarios.includes(candidato.userId)
                  }
                />
                <span>
                  {candidato.nome}
                  {candidato.email ? (
                    <span className="sub"> · {candidato.email}</span>
                  ) : (
                    <span className="badge badge-danger" style={{ marginLeft: 6 }}>
                      sem e-mail
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="field-hint" style={{ marginBottom: 10 }}>
          Desmarcar todos equivale a mandar para todo mundo — para não
          enviar nada, desligue o relatório no campo “Ativo” acima.
        </div>

        <button type="submit" className="btn btn-ghost btn-sm">
          Salvar destinatários
        </button>
      </form>
    </div>
  );
}
