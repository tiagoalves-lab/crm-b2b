// Onde o puppeteer guarda (no build) e procura (em produção) o Chrome que gera
// o PDF das propostas. Fixado na pasta do projeto porque a variável
// PUPPETEER_CACHE_DIR do nixpacks.toml não chegava ao processo em produção:
// o diagnóstico (GET integrations/cotacoes/propostas/diagnostico) respondia
// "Could not find Chrome … cache path (which is: )" — caminho vazio. Com o
// arquivo, build e runtime leem o mesmo lugar sem depender de ambiente, e o
// railway.json instala o Chrome aqui explicitamente antes do build.
const { join } = require('path');

module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
