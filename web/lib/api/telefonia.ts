import { apiFetch } from "./client";

// Telefonia (docs/telefonia-crm.md). O navegador não fala com a linha
// telefônica: o CRM registra a chamada e devolve um endereço `sip:`, que o
// Windows entrega ao MicroSIP — é ele que disca. Os eventos de início/fim
// voltam pelo script instalado na máquina do SDR, direto no backend.

export interface Chamada {
  id: string;
  telefone: string;
  telefoneExibicao: string | null;
  companyId: string | null;
  contactId: string | null;
  direcao: "saida" | "entrada";
  resultado: "atendida" | "nao_atendida" | "cancelada" | null;
  iniciadaEm: string;
  atendidaEm: string | null;
  encerradaEm: string | null;
  duracaoSegundos: number | null;
  observacao: string | null;
}

export interface ChamadaIniciada extends Chamada {
  // Endereço que a tela abre pra o MicroSIP discar. `discarUri` é o nosso
  // (gamafone:), registrado pelo instalador da máquina; `sipUri` fica de
  // reserva — em Windows com Office, o sip: pertence ao Skype for
  // Business e o clique abria a tela de login dele.
  discarUri: string;
  sipUri: string;
}

export interface IniciarChamadaInput {
  telefone: string;
  companyId?: string;
  contactId?: string;
  rawLeadId?: string;
  taskId?: string;
}

export function iniciarChamada(
  token: string,
  input: IniciarChamadaInput,
): Promise<ChamadaIniciada> {
  return apiFetch<ChamadaIniciada>("/telefonia/chamadas", {
    method: "POST",
    token,
    body: input,
    timeoutMs: 15_000,
  });
}

export function atualizarChamada(
  token: string,
  id: string,
  input: { observacao?: string; resultado?: "atendida" | "nao_atendida" },
): Promise<Chamada> {
  return apiFetch<Chamada>(`/telefonia/chamadas/${id}`, {
    method: "PATCH",
    token,
    body: input,
    timeoutMs: 15_000,
  });
}

export function listarChamadas(
  token: string,
  options: { companyId?: string; pageSize?: number } = {},
): Promise<{ items: Chamada[] }> {
  const query = new URLSearchParams();
  if (options.companyId) query.set("companyId", options.companyId);
  if (options.pageSize) query.set("pageSize", String(options.pageSize));
  const sufixo = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<{ items: Chamada[] }>(`/telefonia/chamadas${sufixo}`, { token });
}

export interface DispositivoTelefonia {
  id: string;
  nome: string;
  userId: string;
  ultimoUsoEm: string | null;
  revogadoEm: string | null;
  criadoEm: string;
}

export function listarDispositivos(token: string): Promise<DispositivoTelefonia[]> {
  return apiFetch<DispositivoTelefonia[]>("/telefonia/dispositivos", { token });
}

export function criarDispositivo(
  token: string,
  input: { nome: string; userId?: string },
): Promise<{ dispositivo: DispositivoTelefonia; token: string }> {
  return apiFetch<{ dispositivo: DispositivoTelefonia; token: string }>(
    "/telefonia/dispositivos",
    { method: "POST", token, body: input },
  );
}

export function revogarDispositivo(
  token: string,
  id: string,
): Promise<DispositivoTelefonia> {
  return apiFetch<DispositivoTelefonia>(`/telefonia/dispositivos/${id}`, {
    method: "DELETE",
    token,
  });
}

// Frase que o SDR fala na abertura da ligação (decisão 1.10 de
// docs/telefonia-crm.md). Mora aqui, num lugar só, porque aparece na
// ficha, na barra da chamada e na tela de configuração da telefonia.
export const AVISO_DE_GRAVACAO =
  "Esta ligação é gravada para fins de qualidade.";
