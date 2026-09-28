import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Teto do HTML da proposta congelada. As imagens do documento são URLs do
// bucket público (o Chromium baixa na hora), então o HTML é texto: a
// proposta de 28 páginas do piloto deu ~300KB. 8MB é folga larga e ao mesmo
// tempo impede que a rota vire canal de upload de qualquer coisa.
export const PROPOSTA_HTML_MAX = 8 * 1024 * 1024;

// "Proposta congelada chegando pro card": o app de cotações (gama-webapp)
// monta o HTML no servidor dele, congela em doc_documentos e manda pra cá
// junto com o hash. Este CRM não monta documento nenhum — ele confere o
// hash, vira PDF e guarda como anexo do card.
//
// Por que o hash viaja junto se o HTML também viaja: ele é a mesma string
// que ficou gravada do outro lado. Conferir aqui prova que o que virou PDF é
// byte a byte o que está guardado como proposta oficial — sem isso, uma
// falha de transporte (ou um payload montado à mão) geraria um PDF que não
// corresponde a nenhum registro.
export class UpsertPropostaDto {
  @IsUUID()
  opportunity_id!: string;

  @IsInt()
  @Min(1)
  orcamento_id!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  orcamento_grupo_id?: number;

  // Versão do DOCUMENTO congelado (doc_documentos.versao), não a versão do
  // orçamento: reenviar a mesma versão 1.0 do orçamento gera v2 do documento.
  @IsInt()
  @Min(1)
  documento_versao!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  documento_id?: number;

  // Etiqueta impressa no próprio documento; é por ela que alguém com o PDF
  // na mão acha o registro do outro lado. Também é o que dá idempotência:
  // reenviar o mesmo código devolve o anexo que já existe.
  @Matches(/^[0-9A-Z]{6,12}$/, {
    message:
      'codigo_verificacao deve ter de 6 a 12 caracteres maiúsculos/dígitos.',
  })
  codigo_verificacao!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nome_arquivo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  numero_documento?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(PROPOSTA_HTML_MAX)
  html!: string;

  @Matches(/^[0-9a-f]{64}$/, {
    message: 'html_sha256 deve ser um SHA-256 em hexadecimal minúsculo.',
  })
  html_sha256!: string;
}
