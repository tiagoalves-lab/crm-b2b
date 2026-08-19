import type { MembershipRole } from '@prisma/client';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const ROLES: MembershipRole[] = [
  'owner',
  'admin',
  'manager',
  'sales_rep',
  'readonly',
];

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

  // Contato do membro — separado do login de propósito (login é só o
  // identificador de acesso, texto livre, ver comentário acima). Não é
  // coluna de Membership: vai pro user_metadata do Supabase Auth via
  // SupabaseUserService, mesmo padrão já usado pra `name`.
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

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

  // Matriz granular da subpágina de Permissões (web/app/dashboard/membros)
  // — shape validado de verdade em MembershipService#create via
  // parsePermissionMatrix (@IsObject aqui é só o filtro grosso de "é um
  // objeto", não valida chave/valor; a validação de conteúdo mora perto do
  // catálogo, não duplicada aqui). Ausente = usa o preset do papel
  // (DEFAULT_PERMISSIONS).
  @IsOptional()
  @IsObject()
  permissions?: Record<string, unknown>;
}
