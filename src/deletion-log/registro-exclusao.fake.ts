// Só para testes unitários: completa um banco simulado (fakeTx) com o que o
// registro de exclusões usa — gravar o registro e buscar o nome da
// empresa/tarefa/oportunidade pro contexto. Não sobrescreve nada que o
// teste já tenha simulado. Sem `jest` aqui dentro de propósito: o arquivo
// entra no build, e o build não conhece os tipos do Jest.
type Tabela = Record<string, unknown>;

export function comRegistroDeExclusao<T>(tx: T): T {
  const original = tx as unknown as Record<string, Tabela | undefined>;
  const nenhum = () => Promise.resolve(null);
  const comBusca = (chave: string): Tabela => ({
    findFirst: nenhum,
    ...(original[chave] ?? {}),
  });
  return {
    ...original,
    deletionLog: { create: () => Promise.resolve({}) },
    task: comBusca('task'),
    opportunity: comBusca('opportunity'),
    company: comBusca('company'),
  } as unknown as T;
}
