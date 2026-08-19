import type { MembershipRole, MembershipStatus } from '@prisma/client';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

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
  // Corrige o nome exibido (ex.: membro criado antes deste campo existir,
  // ou digitado errado) — não é coluna de Membership, vai pro
  // user_metadata do Supabase Auth via SupabaseUserService#updateUserProfile,
  // chamado pelo controller FORA da transação (mesmo motivo de
  // getIdentities: é uma chamada HTTP, não uma query).
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  // Mesmo tratamento de name acima — não é coluna de Membership, vai pro
  // user_metadata via SupabaseUserService#updateUserProfile.
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  // Muda o identificador de acesso (o e-mail real do Supabase Auth por
  // trás dele) via SupabaseUserService#updateUserLogin — mesma validação
  // de forma de CreateMembershipDto#login (texto livre, sem exigir
  // formato de e-mail). Ausente = não mexe no login atual.
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  login?: string;

  // Redefine a senha do login (Supabase Auth) — não existe "ver senha"
  // possível em nenhum sistema seguro (Supabase guarda só hash, nem o
  // próprio dashboard deles mostra); isto é o equivalente prático:
  // admin/owner define uma nova. Ausente = não mexe na senha atual.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

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

  // Mesmo campo/validação de CreateMembershipDto — ver comentário lá.
  @IsOptional()
  @IsObject()
  permissions?: Record<string, unknown>;
}
