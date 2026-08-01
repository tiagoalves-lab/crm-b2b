import { getCompany } from "@/lib/api/companies";
import { getOpportunity } from "@/lib/api/opportunities";
import { listPipelines } from "@/lib/api/pipelines";

// Carregamento compartilhado entre a versão full-page do detalhe de
// oportunidade (pipeline/[id]/page.tsx, fallback de acesso direto) e a
// versão modal interceptada (@modal/(.)pipeline/[id]/page.tsx).
export async function loadOpportunityDetail(token: string, id: string) {
  const opportunity = await getOpportunity(token, id);
  const [company, { items: pipelines }] = await Promise.all([
    getCompany(token, opportunity.companyId),
    listPipelines(token),
  ]);
  const pipeline = pipelines.find((p) => p.id === opportunity.pipelineId);
  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];
  const stage = stages.find((s) => s.id === opportunity.stageId);
  const maxOrder = stages.reduce((max, s) => Math.max(max, s.order), 0);

  return { opportunity, company, stages, stage, maxOrder };
}

export type OpportunityDetail = Awaited<ReturnType<typeof loadOpportunityDetail>>;
