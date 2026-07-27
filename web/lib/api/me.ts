import { apiFetch } from "./client";
import type { MeResponse } from "./types";

export function getMe(token: string): Promise<MeResponse> {
  return apiFetch<MeResponse>("/me", { token });
}
