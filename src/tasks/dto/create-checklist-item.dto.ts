import { IsString, MaxLength } from 'class-validator';

export class CreateChecklistItemDto {
  @IsString()
  @MaxLength(500)
  text!: string;
}
