import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// Tipo só (apagado na compilação) — o puppeteer em si é carregado tarde, no
// primeiro render, dentro do getBrowser. Dois motivos: o pacote traz um
// Chromium de ~300MB que não precisa ser tocado no boot de um CRM que quase
// nunca gera PDF, e o resolvedor do jest escolhe a build ESM dele, o que
// derrubaria toda suíte que só monta a aplicação.
import type { Browser } from 'puppeteer';

// Converte HTML em PDF com o MESMO motor que o usuário usa no Ctrl+P do
// Chrome. É deliberado: a proposta comercial da Gama é um layout A4 de
// posicionamento absoluto, montado e conferido contra o que o Chrome
// imprime. Qualquer outro conversor (o do Apps Script, bibliotecas de
// PDF puro) reescreve o layout com regras próprias e o documento que chega
// ao cliente deixa de ser o que foi aprovado na tela.
//
// O que NÃO é obvio aqui:
// - **Um Chrome só, reaproveitado.** Subir o navegador custa ~1,6s e
//   ~300MB; abrir um por requisição derrubaria o contêiner num pico. Cada
//   render usa uma aba nova (isolada) e a fecha no fim.
// - **Um render por vez** (fila interna). Dois Chromes renderizando um A4
//   com imagens ao mesmo tempo é o caminho mais curto pro OOM do contêiner.
//   Envio de proposta é ato humano esporádico, não carga.
// - **As imagens vêm da internet** (bucket público de propostas do app de
//   cotações), por isso o `networkidle0` com prazo: PDF sem a foto da
//   máquina não serve, e esperar pra sempre também não.
// - **Nunca confiar no HTML recebido pra navegar**: `setContent` não segue
//   redirecionamento nem executa navegação; o conteúdo entra como string e
//   o contexto morre com a aba.
@Injectable()
export class HtmlPdfService implements OnModuleDestroy {
  private readonly logger = new Logger(HtmlPdfService.name);
  private browser: Browser | null = null;
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    await this.fecharBrowser();
  }

  async renderPdf(
    html: string,
    opcoes: { timeoutMs?: number } = {},
  ): Promise<Buffer> {
    // Serializa os renders sem perder a rejeição de quem está na frente:
    // a fila guarda sempre uma promise que resolve (nunca rejeita), senão
    // um erro de um render derrubaria o próximo.
    const anterior = this.fila;
    let liberar!: () => void;
    this.fila = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    await anterior;
    try {
      return await this.renderAgora(html, opcoes.timeoutMs ?? 45_000);
    } finally {
      liberar();
    }
  }

  private async renderAgora(html: string, timeoutMs: number): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      const t0 = Date.now();
      await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
      // `setContent` volta no `load`, que NÃO garante a foto da máquina
      // baixada (as imagens do documento são URLs do bucket público do app
      // de cotações). Esperar imagem por imagem é mais honesto que um
      // "networkidle" genérico: o que precisa estar pronto pro PDF é
      // exatamente a imagem e a fonte. Imagem que falha resolve pelo
      // `onerror` — o documento sai com o placeholder que o próprio app
      // gerou, nunca travado aqui.
      // O prazo vai por dentro do evaluate: imagem que nem carrega nem dá
      // erro (servidor que aceita a conexão e não responde) deixaria o
      // render pendurado, e aí não há timeout do puppeteer que pegue.
      await page.evaluate(
        async (prazoMs: number) => {
          const pendentes = Promise.all(
            Array.from(document.images)
              .filter((img) => !img.complete)
              .map(
                (img) =>
                  new Promise<void>((resolve) => {
                    img.addEventListener('load', () => resolve(), {
                      once: true,
                    });
                    img.addEventListener('error', () => resolve(), {
                      once: true,
                    });
                  }),
              ),
          ).then(() => document.fonts.ready);
          await Promise.race([
            pendentes,
            new Promise<void>((resolve) => setTimeout(resolve, prazoMs)),
          ]);
        },
        Math.min(timeoutMs, 20_000),
      );
      // preferCSSPageSize honra o `@page { size: A4 }` que os templates da
      // Gama declaram; sem isso o Chrome usa a página do `format` e o
      // layout absoluto sai deslocado.
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        timeout: timeoutMs,
      });
      this.logger.log(
        `PDF gerado: ${pdf.length} bytes em ${Date.now() - t0}ms (${html.length} chars de HTML)`,
      );
      return Buffer.from(pdf);
    } catch (erro) {
      // Chrome que morreu no meio deixa o browser inutilizável: derruba pra
      // o próximo render subir um novo em vez de falhar pra sempre.
      await this.fecharBrowser();
      const motivo = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Falha ao gerar PDF: ${motivo}`);
      throw new InternalServerErrorException(
        `Não foi possível gerar o PDF da proposta: ${motivo}`,
      );
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // Diagnóstico de uma linha: o Chromium sobe neste contêiner? É o que se
  // confere com um curl depois do deploy, sem precisar de uma proposta de
  // verdade — a instalação do navegador é a única parte desta feature que só
  // se prova no servidor (no build do Railway, não no PC de quem programa).
  async diagnostico(): Promise<{
    ok: boolean;
    versao?: string;
    erro?: string;
  }> {
    try {
      const browser = await this.getBrowser();
      return { ok: true, versao: await browser.version() };
    } catch (erro) {
      return {
        ok: false,
        erro: erro instanceof Error ? erro.message : String(erro),
      };
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = require('puppeteer') as typeof import('puppeteer');
    this.browser = await puppeteer.launch({
      headless: true,
      // O contêiner do Railway roda como root e sem /dev/shm grande — as
      // duas flags são o par padrão pra Chrome em contêiner.
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      // Vazio = usa o Chrome que o puppeteer baixou no build. A variável
      // existe pro caso de o contêiner trazer o chromium do sistema.
      executablePath:
        this.config.get<string>('chromiumExecutablePath') || undefined,
    });
    this.logger.log('Chromium iniciado para geração de PDF.');
    return this.browser;
  }

  private async fecharBrowser(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => undefined);
  }
}
