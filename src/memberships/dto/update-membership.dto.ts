import type { MembershipRole, MembershipStatus } from '@prisma/client';
import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';

const ROLES: MembershipRole[] = [
  'owner',
  'admin',
  'manager',
  'sales_rep',
  'readonly',
];
// "invited" não é setável por aqui — é o estado inicial de um fluxo de
// convite que não existe ainda (ver docs/roadmap.md, Fase 2 adiada).
const STATUSES: MembershipStatus[] = ['active', 'suspended'];

export class UpdateMembershipDto {
  @IsOptional()
  @IsIn(ROLES)
  role?: MembershipRole;

  @IsOptional()
  @IsIn(STATUSES)
  status?: MembershipStatus;

  // Aceita string (novo gerente), null (limpar) ou ausente (não mexer).
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  managerId?: string | null;
}
