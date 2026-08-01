import type { MembershipRole } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const ROLES: MembershipRole[] = ['owner', 'admin', 'manager', 'sales_rep', 'readonly'];

// Cria login (Supabase Auth, via SupabaseUserService) + Membership numa
// tacada só. Sem fluxo de convite por e-mail (adiado no roadmap) — o
// admin já define a senha do novo membro aqui.
export class CreateMembershipDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: MembershipRole;

  @IsOptional()
  @IsUUID()
  managerId?: string;
}
