import { montarLogradouro } from './logradouro';

// Regra nasceu de um estrago silencioso: sem juntar o tipo, "Buscar
// dados" trocava "RUA FULANO" por "FULANO" em toda ficha consultada.
describe('montarLogradouro', () => {
  it('junta o tipo ao nome da via', () => {
    expect(montarLogradouro('RUA', 'DOS ANDRADAS')).toBe('RUA DOS ANDRADAS');
    expect(montarLogradouro('AVENIDA', 'BRASIL')).toBe('AVENIDA BRASIL');
  });

  it('não duplica quando o nome já começa com o tipo', () => {
    // Caso real de endereço de Brasília na resposta da Receita.
    expect(montarLogradouro('QUADRA', 'QUADRA 5 BLOCO B')).toBe(
      'QUADRA 5 BLOCO B',
    );
    // A comparação ignora caixa: a Receita mistura os dois formatos.
    expect(montarLogradouro('Rua', 'RUA DAS FLORES')).toBe('RUA DAS FLORES');
  });

  it('devolve o nome sozinho quando não veio tipo', () => {
    expect(montarLogradouro(undefined, 'DOS ANDRADAS')).toBe('DOS ANDRADAS');
    expect(montarLogradouro('   ', 'DOS ANDRADAS')).toBe('DOS ANDRADAS');
  });

  it('não inventa endereço quando não veio nome', () => {
    // undefined (e não "RUA") — quem consome trata "campo não devolvido"
    // como "não mexe no que está gravado".
    expect(montarLogradouro('RUA', undefined)).toBeUndefined();
    expect(montarLogradouro('RUA', '  ')).toBeUndefined();
    expect(montarLogradouro(null, null)).toBeUndefined();
  });

  it('tira espaço sobrando das pontas', () => {
    expect(montarLogradouro(' RUA ', ' DOS ANDRADAS ')).toBe(
      'RUA DOS ANDRADAS',
    );
  });
});
