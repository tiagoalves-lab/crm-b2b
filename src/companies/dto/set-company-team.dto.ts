import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

// Estado final da aba "Equipe de vendas" (ver CompanyTeamService.set) —
// a lista inteira, não um delta.
export class SetCompanyTeamDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  userIds!: string[];
}
