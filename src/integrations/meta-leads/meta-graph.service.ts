import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MetaLeadDetail } from './meta-leads.types';

// Versão fixada de propósito (a Graph API versiona a URL) — subir de versão
// vira uma mudança consciente com teste, não algo que acontece sozinho
// quando a Meta muda o default. v26.0 era a mais recente quando isto foi
// escrito (conferido na doc oficial em 2026-08-14). A Meta garante cada
// versão por ~2 anos, então revisar por volta de 2028; expirada, a chamada
// é encaminhada pra versão mais antiga ainda viva, o que muda o
// comportamento sem aviso — por isso a data acima importa.
const GRAPH_BASE = 'https://graph.facebook.com/v26.0';

// Cliente do segundo request do fluxo: o webhook `leadgen` só avisa o
// `leadgen_id`, as respostas do formulário vêm daqui (ver
// docs/webhook-meta-leads.md). Só leitura — este módulo nunca escreve na
// Meta, diferente da integração eGestor.
@Injectable()
export class MetaGraphService {
  constructor(private readonly config: ConfigService) {}

  async buscarLead(leadgenId: string): Promise<MetaLeadDetail> {
    const token = this.config.get<string>('metaPageAccessToken');
    if (!token) {
      throw new InternalServerErrorException(
        'META_PAGE_ACCESS_TOKEN não configurado — não é possível buscar os campos do lead.',
      );
    }

    const url = new URL(`${GRAPH_BASE}/${encodeURIComponent(leadgenId)}`);
    url.searchParams.set('fields', 'id,created_time,ad_id,form_id,field_data');

    // Token no header, nunca na query string: URL completa costuma aparecer
    // em log de acesso/proxy, header não (mesma disciplina de
    // docs/seguranca.md sobre segredo em texto legível).
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      // Mensagem de erro da Meta pode ecoar parte do request — nunca
      // interpola o token aqui (só o id do lead, que não é segredo).
      throw new InternalServerErrorException(
        `Falha ao buscar lead ${leadgenId} na Graph API. HTTP ${res.status}: ${JSON.stringify(body)}`,
      );
    }

    return body as MetaLeadDetail;
  }
}
