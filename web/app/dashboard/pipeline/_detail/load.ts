import { getMe } from "@/lib/api/me";
import { getCompany } from "@/lib/api/companies";
import { listMemberships } from "@/lib/api/memberships";
import { getOpportunity } from "@/lib/api/opportunities";
import { listAttachments } from "@/lib/api/opportunity-attachments";
import { listPipelines } from "@/lib/api/pipelines";

// Carregamento compartilhado entre a versão full-page do detalhe de
// oportunidade (pipeline/[id]/page.tsx, fallback de acesso direto) e a
// versão modal interceptada (@modal/(.)pipeline/[id]/page.tsx).
export async function loadOpportunityDetail(token: string, id: string) {
  const [me, opportunity, attachments, memberships] = await Promise.all([
    getMe(token),
    getOpportunity(token, id),
    listAttachments(token, id),
    listMemberships(token),
  ]);
  const [company, { items: pipelines }] = await Promise.all([
    getCompany(token, opportunity.companyId),
    listPipelines(token),
  ]);
  const pipeline = pipelines.find((p) => p.id === opportunity.pipelineId);
  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];
  const stage = stages.find((s) => s.id === opportunity.stageId);
  const maxOrder = stages.reduce((max, s) => Math.max(max, s.order), 0);

  return { me, opportunity, attachments, memberships, company, stages, stage, maxOrder };
}

export type OpportunityDetail = Awaited<ReturnType<typeof loadOpportunityDetail>>;
