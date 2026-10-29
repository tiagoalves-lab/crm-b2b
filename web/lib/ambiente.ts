// Ambiente beta (2026-10-20): endereço fixo de teste, separado do CRM
// oficial, no molde "dev × exec" do Apps Script. NEXT_PUBLIC_AMBIENTE=beta
// existe só no ambiente Preview da Vercel — produção não tem a variável,
// então nada muda lá. Serve só pra marcar visualmente o beta: os dados
// por trás são os mesmos (não existe banco de teste).
export const IS_BETA = process.env.NEXT_PUBLIC_AMBIENTE === "beta";
