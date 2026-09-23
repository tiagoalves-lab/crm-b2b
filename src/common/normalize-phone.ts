// Normalização de telefone brasileiro para discagem (2026-09-23,
// docs/telefonia-crm.md, decisão 1.9). A base tem telefone digitado à mão
// vindo de planilha, Receita, eGestor e Meta — "(55) 3220-1234",
// "55 99999-8888", "+55 55 99999-8888", "0800 123 4567" convivem na mesma
// coluna. Sem isto, metade das ligações sairia errada ou nem sairia.
//
// Resultado: só dígitos, com código do país na frente (5555999998888).
// É esse formato que vira o link sip: e é a chave que casa o evento vindo
// do MicroSIP (que só conhece o número discado) com a chamada registrada.

const DDI_BRASIL = '55';

// DDDs válidos no Brasil (Anatel). Serve pra distinguir "11987654321"
// (DDD 11 + celular) de um número já com DDI ou de um ramal interno.
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35,
  37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64,
  65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88,
  89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export interface TelefoneNormalizado {
  // Pronto pra discar: dígitos com DDI. `null` quando não dá pra discar
  // com segurança — a tela avisa em vez de gastar uma tentativa.
  e164: string | null;
  motivo?: 'vazio' | 'curto' | 'ddd-invalido' | 'internacional-nao-suportado';
}

export function normalizarTelefone(entrada: string | null | undefined): TelefoneNormalizado {
  const texto = (entrada ?? '').trim();
  const digitos = texto.replace(/\D/g, '');
  if (!digitos) return { e164: null, motivo: 'vazio' };

  // "+1 415 555 2671" tem 11 dígitos e passaria como celular de DDD 14 se
  // o sinal fosse ignorado — a ligação sairia para o número errado, no
  // Brasil. Quem escreveu o "+" declarou o país: só o 55 é nosso.
  if (texto.startsWith('+') && !digitos.startsWith(DDI_BRASIL)) {
    return { e164: null, motivo: 'internacional-nao-suportado' };
  }

  // 0800/0300/4003 e afins: número sem DDD, discado como está.
  if (/^(0800|0300|0500|0900)/.test(digitos)) {
    return { e164: digitos };
  }
  if (/^4(00[0-9]|0[0-9]{2})/.test(digitos) && digitos.length === 10) {
    return { e164: digitos };
  }

  // Já veio com o código do país.
  if (digitos.startsWith(DDI_BRASIL) && (digitos.length === 12 || digitos.length === 13)) {
    const ddd = Number(digitos.slice(2, 4));
    if (!DDDS_VALIDOS.has(ddd)) return { e164: null, motivo: 'ddd-invalido' };
    return { e164: digitos };
  }

  // Número nacional com DDD (10 dígitos fixo, 11 celular).
  if (digitos.length === 10 || digitos.length === 11) {
    const ddd = Number(digitos.slice(0, 2));
    if (!DDDS_VALIDOS.has(ddd)) return { e164: null, motivo: 'ddd-invalido' };
    return { e164: `${DDI_BRASIL}${digitos}` };
  }

  // Com zero da operadora antiga na frente ("055 55 ...", "0 55 ...").
  if (digitos.startsWith('0') && (digitos.length === 11 || digitos.length === 12)) {
    return normalizarTelefone(digitos.replace(/^0+/, ''));
  }

  if (digitos.length < 10) return { e164: null, motivo: 'curto' };

  // 14 dígitos ou mais sem ser brasileiro: fora do escopo desta etapa —
  // a linha da Gama é nacional, e deixar passar geraria chamada cara sem
  // ninguém perceber.
  return { e164: null, motivo: 'internacional-nao-suportado' };
}

// Mesma normalização, mas devolvendo só o número discável (ou null) —
// açúcar pros call sites que não querem saber o motivo.
export function telefoneDiscavel(entrada: string | null | undefined): string | null {
  return normalizarTelefone(entrada).e164;
}

// Variantes que um evento do MicroSIP pode trazer pro mesmo número: ele
// reporta o que foi efetivamente discado, que nem sempre é o que gravamos
// (pode vir sem DDI, ou com o 9 do celular a mais/a menos). Usado pra
// casar evento com chamada em aberto.
export function variantesDeBusca(e164: string): string[] {
  const variantes = new Set<string>([e164]);
  if (e164.startsWith(DDI_BRASIL) && e164.length >= 12) {
    const nacional = e164.slice(2);
    variantes.add(nacional);
    // Celular de 9 dígitos ⇄ 8 dígitos (base antiga ainda tem os dois).
    const ddd = nacional.slice(0, 2);
    const assinante = nacional.slice(2);
    if (assinante.length === 9 && assinante.startsWith('9')) {
      variantes.add(`${DDI_BRASIL}${ddd}${assinante.slice(1)}`);
      variantes.add(`${ddd}${assinante.slice(1)}`);
    }
    if (assinante.length === 8) {
      variantes.add(`${DDI_BRASIL}${ddd}9${assinante}`);
      variantes.add(`${ddd}9${assinante}`);
    }
  }
  return [...variantes];
}
