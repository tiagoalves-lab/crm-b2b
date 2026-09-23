// Resultado que a TELA pode gravar quando o script da máquina não
// registrou a chamada (PC sem o programa, MicroSIP fechado, SDR ligou de
// outro jeito). `cancelada` fica de fora de propósito: é o estado que o
// sistema atribui sozinho a uma intenção de ligação que nunca virou
// chamada — não é algo que o usuário escolhe.
export const RESULTADOS_MANUAIS = ['atendida', 'nao_atendida'] as const;

// Janela em que um evento vindo do MicroSIP ainda é considerado "a mesma
// ligação" que o clique no botão Ligar. Acima disso, o evento vira uma
// chamada própria (o SDR discou direto no MicroSIP, sem passar pelo CRM) —
// o que continua sendo registrado, só sem vínculo garantido de empresa.
export const JANELA_CASAMENTO_MINUTOS = 10;

// Depois disso, uma chamada que nunca recebeu evento nem encerramento
// manual é considerada `cancelada` na leitura — evita "ligação em
// andamento" eterna na tela de quem clicou em Ligar e desistiu.
export const JANELA_ABANDONO_MINUTOS = 60;
