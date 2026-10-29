import { IsISO8601, IsOptional, Matches } from 'class-validator';

// Metadados que acompanham o áudio em POST /telefonia/gravacoes. Vêm na
// query string porque o corpo é o próprio arquivo (audio/mpeg ou
// audio/wav), não JSON.
export class EnviarGravacaoDto {
  // Nome que o MicroSIP deu ao arquivo (ele troca espaço, ponto e barra por
  // "_"). O padrão fechado também impede caminho no nome — e o arquivo no
  // bucket nunca usa este nome, só o id da gravação.
  @Matches(/^[A-Za-z0-9_+-]{1,200}\.(mp3|wav)$/)
  arquivo!: string;

  // Criação do arquivo no PC, em UTC. Opcional: sem ela, vale a data e hora
  // do próprio nome (horário de Brasília).
  @IsOptional()
  @IsISO8601()
  gravadoEm?: string;
}
