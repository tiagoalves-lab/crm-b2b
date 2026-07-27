import { apiFetch } from "./client";
import type { PaginatedResult, Pipeline } from "./types";

export function listPipelines(token: string): Promise<PaginatedResult<Pipeline>> {
  return apiFetch<PaginatedResult<Pipeline>>("/pipelines?pageSize=50", {
    token,
  });
}

export interface CreatePipelineInput {
  name: string;
  isDefault?: boolean;
}

export function createPipeline(
  token: string,
  input: CreatePipelineInput,
): Promise<Pipeline> {
  return apiFetch<Pipeline>("/pipelines", { method: "POST", token, body: input });
}

export interface CreateStageInput {
  name: string;
  order: number;
  probability: number;
  isWon?: boolean;
  isLost?: boolean;
}

export function createStage(
  token: string,
  pipelineId: string,
  input: CreateStageInput,
): Promise<unknown> {
  return apiFetch(`/pipelines/${pipelineId}/stages`, {
    method: "POST",
    token,
    body: input,
  });
}
