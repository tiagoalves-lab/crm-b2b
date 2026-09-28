// Endereço completo a partir dos dois campos que a Receita Federal devolve
// separados: `descricao_tipo_de_logradouro` ("RUA", "AVENIDA") e
// `logradouro` (só o nome da via).
//
// Achado em 2026-09-24, conferindo os leads convertidos contra a Receita:
// 22 de 31 cadastros apareciam como "divergentes" só porque o CRM tinha
// "RUA FULANO" e a consulta devolvia "FULANO". O cadastro do CRM é que
// estava certo — e, pior, apertar "Buscar dados" na ficha APAGAVA o tipo
// do logradouro, degradando em silêncio um endereço bom. Valia pros três
// chamadores do cartão CNPJ: a ficha, a sanitização em lote e o webhook
// do eGestor.
export function montarLogradouro(
  tipo: string | undefined | null,
  nome: string | undefined | null,
): string | undefined {
  const nomeLimpo = nome?.trim();
  const tipoLimpo = tipo?.trim();
  // Vazio vira `undefined`, não string vazia: quem consome o cartão CNPJ
  // trata `undefined` como "a Receita não devolveu, não mexe no que está
  // gravado" (ver montarAtualizacaoCartaoCnpj) — devolver "" apagaria um
  // endereço bom.
  if (!nomeLimpo) return undefined;
  if (!tipoLimpo) return nomeLimpo;
  // Não duplica quando o nome já traz o tipo embutido — acontece em
  // endereço de Brasília, ex.: tipo "QUADRA" com logradouro "SAUN QUADRA
  // 5 BLOCO B".
  if (nomeLimpo.toUpperCase().startsWith(tipoLimpo.toUpperCase())) {
    return nomeLimpo;
  }
  return `${tipoLimpo} ${nomeLimpo}`;
}
