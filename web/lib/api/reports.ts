import { apiFetch } from "./client";

// Tela "E-mail automático" (Administração) — configuração dos reports
// recorrentes. Só owner/admin: o backend responde 403 pros demais papéis,
// e o nav esconde o item.

export type TipoReport = "pipeline-diario" | "pipeline-followup";

export interface ReportConfig {
  tipo: TipoReport;
  ativo: boolean;
  // "HH:MM" no fuso de Brasília. O resumo diário tem um; o follow-up,
  // vários.
  horarios: string[];
  diasUteis: boolean;
  // Só o follow-up usa (etapas do Pipeline que entram na lista).
  etapas: string[];
  // Quem recebe ESTE relatório. Vazio = todos os elegíveis (padrão).
  destinatarios: string[];
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

export interface ReportEnvio {
  tipo: string;
  referencia: string;
  status: string;
  destinatarios: number;
  erro: string | null;
  criadoEm: string;
}

export interface ReportConfigPage {
  configs: ReportConfig[];
  etapasDisponiveis: string[];
  // Candidatos: todo membro ativo que não é representante.
  destinatarios: { userId: string; nome: string; email: string | null }[];
  // false = o provedor de e-mail não está configurado no servidor; a tela
  // avisa em vez de deixar o usuário salvar horários que não disparam.
  envioConfigurado: boolean;
  ultimosEnvios: ReportEnvio[];
}

export function getReportConfig(token: string): Promise<ReportConfigPage> {
  return apiFetch<ReportConfigPage>("/reports/config", { token });
}

export function saveReportConfig(
  token: string,
  tipo: TipoReport,
  patch: {
    ativo?: boolean;
    horarios?: string[];
    diasUteis?: boolean;
    etapas?: string[];
    destinatarios?: string[];
  },
): Promise<ReportConfig> {
  return apiFetch<ReportConfig>(`/reports/config/${tipo}`, {
    token,
    method: "PATCH",
    body: patch,
  });
}

export interface ResultadoEnvio {
  status: "enviado" | "falha" | "ja-enviado" | "desligado";
  destinatarios: number;
  erro?: string;
  messageId?: string;
}

export function enviarReportAgora(
  token: string,
  tipo: TipoReport,
): Promise<ResultadoEnvio> {
  return apiFetch<ResultadoEnvio>(`/reports/${tipo}/enviar`, {
    token,
    method: "POST",
  });
}

export function enviarReportTeste(
  token: string,
  tipo: TipoReport,
  para: string,
): Promise<ResultadoEnvio> {
  return apiFetch<ResultadoEnvio>(
    `/reports/${tipo}/testar?para=${encodeURIComponent(para)}`,
    { token, method: "POST" },
  );
}
