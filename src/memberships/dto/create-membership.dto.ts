import type { MembershipRole } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const ROLES: MembershipRole[] = ['owner', 'admin', 'manager', 'sales_rep', 'readonly'];

// Cria login (Supabase Auth, via SupabaseUserService) + Membership numa
// tacada só. Sem fluxo de convite (adiado no roadmap) — o admin já
// define login/senha do novo membro aqui. Regra de negócio: login é
// texto livre (não e-mail) — a conversão pro formato exigido pela API
// do Supabase Auth é detalhe interno do SupabaseUserService.
export class CreateMembershipDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  login!: string;

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
