import {
  linhasNumeradas,
  montarFalas,
  trechosComFala,
} from './transcricao.service';

describe('trechosComFala', () => {
  it('tira trecho vazio e o que o Whisper marcou como silêncio', () => {
    const trechos = trechosComFala([
      { start: 0, text: ' Bom dia, aqui é da Gama.', no_speech_prob: 0.01 },
      { start: 4, text: '   ' },
      { start: 6, text: ' Obrigado por assistir.', no_speech_prob: 0.95 },
      { start: 9, text: ' Pois não?' },
    ]);
    expect(trechos.map((t) => t.start)).toEqual([0, 9]);
  });
});

describe('linhasNumeradas', () => {
  it('numera a partir de 1 com minuto:segundo', () => {
    expect(
      linhasNumeradas([
        { start: 0, text: ' Alô?' },
        { start: 75.6, text: ' Pode mandar.' },
      ]),
    ).toBe('[1] (00:00) Alô?\n[2] (01:15) Pode mandar.');
  });
});

describe('montarFalas', () => {
  const trechos = [
    { start: 0, text: ' Bom dia, aqui é da Gama.' },
    { start: 3.4, text: ' Bom dia.' },
    { start: 5, text: ' Queria um orçamento' },
    { start: 7, text: ' para duas máquinas.' },
  ];

  it('mantém o texto literal e aplica o falante indicado', () => {
    const falas = montarFalas(trechos, [
      { trecho: 1, quem: 'representante' },
      { trecho: 2, quem: 'cliente' },
      { trecho: 3, quem: 'cliente' },
      { trecho: 4, quem: 'cliente' },
    ]);
    expect(falas).toEqual([
      { inicio: 0, quem: 'representante', texto: 'Bom dia, aqui é da Gama.' },
      { inicio: 3, quem: 'cliente', texto: 'Bom dia.' },
      { inicio: 5, quem: 'cliente', texto: 'Queria um orçamento' },
      { inicio: 7, quem: 'cliente', texto: 'para duas máquinas.' },
    ]);
  });

  it('trecho pulado pelo modelo herda o falante anterior', () => {
    const falas = montarFalas(trechos, [
      { trecho: 2, quem: 'cliente' },
      { trecho: 3, quem: 'cliente' },
    ]);
    expect(falas.map((f) => f.quem)).toEqual([
      'representante',
      'cliente',
      'cliente',
      'cliente',
    ]);
  });
});
