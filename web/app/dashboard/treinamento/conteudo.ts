// Conteúdo dos slides de treinamento (pedido do usuário, 2026-09-17).
// Nasceu como página HTML avulsa e foi incorporado aqui. O texto, a
// estrutura e o estilo dos slides moram só neste arquivo — alterar o
// treinamento é alterar TREINAMENTO_HTML/TREINAMENTO_CSS.
//
// Regras pra editar (ver slides-viewer.tsx):
// - Cada slide é um <section class="slide"> com data-grp (grupo no índice)
//   e data-t (título no índice).
// - Sem <script> e sem fonte/CSS externo: a CSP do CRM bloqueia os dois.
// - Nenhum dado real de empresa/pessoa — os exemplos são fictícios.

export const TREINAMENTO_CSS = `:host{display:block;
  --bg:#eef0f4; --surface:#ffffff; --sunken:#f3f5f8; --border:#dde1e7; --border-strong:#c5cbd4;
  --text:#1a1e24; --text-2:#5b6472; --text-3:#838c99;
  --accent:#052df4; --accent-soft:rgba(5,45,244,.08);
  --c-prosp:#7a52d6; --c-pipe:#052df4; --c-tar:#1f8a4c; --c-emp:#b8620f;
  --danger:#c8402f; --danger-soft:rgba(200,64,47,.1); --ok:#1f8a4c; --ok-soft:rgba(31,138,76,.1);
  --warn-soft:rgba(184,98,15,.12);
  --shadow:0 1px 2px rgba(20,24,29,.06),0 8px 28px rgba(20,24,29,.07);
  --f-display:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",sans-serif;
  --f-body:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",sans-serif;
  --f-mono:"JetBrains Mono","SF Mono",ui-monospace,"Cascadia Code",monospace;
}
*{box-sizing:border-box}
.raiz{color:var(--text);font-family:var(--f-body);font-size:14px}
.app{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:230px 1fr;gap:20px;align-items:start}
@media (max-width:900px){.app{grid-template-columns:1fr}.toc{display:none}}

/* ===== índice lateral ===== */
.toc{position:sticky;top:14px;max-height:calc(100vh - 28px);overflow:auto;padding-right:4px}
.toc h1{font-family:var(--f-display);font-size:15px;margin:4px 0 2px;font-weight:700}
.toc .sub{color:var(--text-3);font-size:12px;margin:0 0 14px}
.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:1px}
.toc .grp{font-family:var(--f-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin:12px 0 4px;display:flex;align-items:center;gap:6px}
.toc .grp i{width:8px;height:8px;border-radius:2px;display:inline-block}
.toc button{all:unset;cursor:pointer;display:flex;gap:8px;width:100%;box-sizing:border-box;padding:5px 8px;border-radius:5px;font-size:12.5px;color:var(--text-2);line-height:1.3}
.toc button span{font-family:var(--f-mono);font-size:10.5px;color:var(--text-3);min-width:18px;padding-top:1px}
.toc button:hover{background:var(--surface)}
.toc button[aria-current="true"]{background:var(--surface);color:var(--text);box-shadow:inset 2px 0 0 var(--accent)}
.toc button:focus-visible{outline:2px solid var(--accent)}

/* ===== barra ===== */
.bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.bar .left{display:flex;gap:8px;align-items:center}
.btn-ui{font:500 13px var(--f-body);color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 12px;cursor:pointer}
.btn-ui:hover{border-color:var(--border-strong)}
.btn-ui:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.btn-ui[aria-pressed="true"]{background:var(--text);color:var(--surface);border-color:var(--text)}
.counter{font-family:var(--f-mono);font-size:12px;color:var(--text-2);font-variant-numeric:tabular-nums}
.progress{height:3px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:12px}
.progress i{display:block;height:100%;background:var(--accent);transition:width .25s}

/* ===== slides ===== */
.stage{container-type:inline-size}
.slide{--ch:var(--accent);position:relative;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);aspect-ratio:16/9;overflow:hidden;font-size:1.45cqw;padding:3.2em 3.6em 2.6em;display:flex;flex-direction:column;gap:1.3em}
.stage.one .slide{display:none}
.stage.one .slide.on{display:flex}
.stage.all{display:grid;gap:22px}
@container (max-width:720px){
  .slide{aspect-ratio:auto;font-size:13.5px;padding:1.6em 1.3em 1.6em}
}
.slide[data-ch="prosp"]{--ch:var(--c-prosp)}
.slide[data-ch="pipe"]{--ch:var(--c-pipe)}
.slide[data-ch="tar"]{--ch:var(--c-tar)}
.slide[data-ch="emp"]{--ch:var(--c-emp)}
.slide::before{content:"";position:absolute;left:0;top:0;bottom:0;width:.42em;background:var(--ch)}
.eyebrow{display:flex;justify-content:space-between;align-items:center;font-family:var(--f-mono);font-size:.72em;letter-spacing:.09em;text-transform:uppercase;color:var(--ch)}
.eyebrow .n{color:var(--text-3)}
.slide h2{font-family:var(--f-display);font-weight:650;font-size:2.15em;line-height:1.12;margin:0;letter-spacing:-.015em;text-wrap:balance;max-width:26ch}
.slide .lead{font-size:1.08em;color:var(--text-2);margin:-.5em 0 0;max-width:62ch;line-height:1.5}
.body{flex:1;min-height:0;display:grid;gap:1.6em;grid-template-columns:1fr 1fr;align-items:start}
.body.wide{grid-template-columns:1.35fr 1fr}
.body.one{grid-template-columns:1fr}
@container (max-width:720px){.body,.body.wide{grid-template-columns:1fr}}
.slide p{margin:0;line-height:1.5}
ul.pts{margin:0;padding:0;list-style:none;display:grid;gap:.72em}
ul.pts li{position:relative;padding-left:1.1em;line-height:1.45}
ul.pts li::before{content:"";position:absolute;left:0;top:.6em;width:.42em;height:.42em;border-radius:1px;background:var(--ch)}
ul.pts b{font-weight:600}
ol.steps{margin:0;padding:0;list-style:none;display:grid;gap:.8em;counter-reset:s}
ol.steps li{counter-increment:s;display:grid;grid-template-columns:1.9em 1fr;gap:.7em;line-height:1.45;align-items:start}
ol.steps li::before{content:counter(s);font-family:var(--f-mono);font-size:.85em;width:2.1em;height:2.1em;display:grid;place-items:center;border-radius:50%;background:color-mix(in srgb,var(--ch) 12%,transparent);color:var(--ch);font-weight:500}
.ui{font-family:var(--f-body);font-weight:600;background:var(--sunken);border:1px solid var(--border);border-radius:4px;padding:.02em .38em;font-size:.93em;white-space:nowrap}
.note{border-radius:6px;padding:.75em 1em;font-size:.93em;line-height:1.45;background:var(--warn-soft)}
.note b{font-weight:600}
.note.bad{background:var(--danger-soft)}
.note.good{background:var(--ok-soft)}
.label{font-family:var(--f-mono);font-size:.68em;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:.5em}
.stack{display:grid;gap:1em;align-content:start}

/* capa / divisores */
.slide.cover{justify-content:space-between;background:
  linear-gradient(var(--surface),var(--surface)) padding-box}
.slide.cover h2{font-size:3.6em;max-width:16ch}
.slide.cover .lead{font-size:1.3em;margin-top:.6em}
.chips4{display:flex;flex-wrap:wrap;gap:.6em}
.chips4 span{font-family:var(--f-display);font-weight:600;font-size:1em;padding:.5em 1em;border-radius:6px;color:#fff}
.slide.divider{justify-content:center;gap:.8em}
.slide.divider h2{font-size:4em;color:var(--ch)}
.slide.divider .lead{font-size:1.3em;margin:0}
.slide.divider .path{font-family:var(--f-mono);font-size:.85em;color:var(--text-3)}

/* ===== maquetes de tela ===== */
.mock{background:var(--surface);border:1px solid var(--border-strong);border-radius:7px;font-size:.8em;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.mock .top{display:flex;justify-content:space-between;align-items:center;gap:.6em;padding:.6em .8em;border-bottom:1px solid var(--border);background:var(--sunken)}
.mock .top b{font-family:var(--f-display);font-weight:600}
.m-btn{display:inline-block;font-weight:600;font-size:.92em;padding:.3em .7em;border-radius:5px;background:var(--accent);color:#fff;white-space:nowrap}
.m-btn.ghost{background:var(--surface);color:var(--text);border:1px solid var(--border-strong)}
.m-btn.green{background:var(--ok)}
.m-btn.red{background:var(--surface);color:var(--danger);border:1px solid var(--danger)}
.m-tabs{display:flex;gap:1.1em;padding:0 .8em;border-bottom:1px solid var(--border);overflow:hidden;flex-wrap:wrap}
.m-tabs span{padding:.55em 0;color:var(--text-2);white-space:nowrap}
.m-tabs span.on{color:var(--text);font-weight:600;box-shadow:inset 0 -2px 0 var(--accent)}
.m-tabs span.lock{color:var(--text-3)}
.m-table{width:100%;border-collapse:collapse}
.m-table th{font-weight:500;text-align:left;color:var(--text-3);font-size:.9em;padding:.45em .8em;border-bottom:1px solid var(--border)}
.m-table td{padding:.5em .8em;border-bottom:1px solid var(--border);vertical-align:top}
.m-table tr:last-child td{border-bottom:0}
.m-table small{display:block;color:var(--text-3);font-size:.88em}
.pill{display:inline-block;font-size:.88em;font-weight:500;padding:.1em .55em;border-radius:99px;white-space:nowrap}
.p-hot{background:var(--danger-soft);color:var(--danger)}
.p-mid{background:var(--warn-soft);color:var(--c-emp)}
.p-cold{background:var(--accent-soft);color:var(--accent)}
.p-ok{background:var(--ok-soft);color:var(--ok)}
.p-gray{background:var(--sunken);color:var(--text-2)}
.m-field{padding:.45em .8em}
.m-field .l{color:var(--text-3);font-size:.88em;margin-bottom:.2em}
.m-field .v{border:1px solid var(--border-strong);border-radius:5px;padding:.35em .55em;color:var(--text-2);background:var(--surface)}
.m-row{display:flex;gap:.5em;align-items:center;flex-wrap:wrap;padding:.55em .8em}
.m-foot{display:flex;justify-content:space-between;gap:.5em;padding:.6em .8em;border-top:1px solid var(--border);background:var(--sunken);flex-wrap:wrap}
.m-foot div{display:flex;gap:.4em}

/* kanban */
.kanban{display:grid;grid-template-columns:repeat(4,1fr);gap:.6em;font-size:.78em}
@container (max-width:720px){.kanban{grid-template-columns:1fr 1fr}}
.kcol{background:var(--sunken);border:1px solid var(--border);border-radius:7px;padding:.55em;display:grid;gap:.5em;align-content:start}
.kcol h4{margin:0;font-size:.95em;font-weight:600;line-height:1.25}
.kcol h4 small{display:block;font-weight:400;color:var(--text-3);font-family:var(--f-mono);font-size:.85em;margin-top:.15em}
.kcard{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:.55em .6em;display:grid;gap:.2em;position:relative}
.kcard b{font-weight:600;padding-right:2.4em;line-height:1.25}
.kcard .sla{position:absolute;right:.45em;top:.45em;font-family:var(--f-mono);font-size:.85em;background:var(--accent-soft);color:var(--accent);border-radius:4px;padding:0 .35em}
.kcard .meta{color:var(--text-3);font-size:.9em}
.kcard .val{font-weight:600;font-variant-numeric:tabular-nums}
.kcard .pend{color:var(--danger);font-size:.9em}

/* fluxo */
.flow{display:flex;align-items:stretch;gap:.5em;flex-wrap:wrap}
.flow .st{flex:1 1 9em;border:1px solid var(--border);border-radius:8px;padding:.9em 1em;background:var(--surface);display:grid;gap:.35em;align-content:start}
.flow .st .k{font-family:var(--f-mono);font-size:.7em;letter-spacing:.08em;text-transform:uppercase}
.flow .st b{font-family:var(--f-display);font-weight:600;font-size:1.15em}
.flow .st p{color:var(--text-2);font-size:.9em}
.flow .arr{align-self:center;color:var(--text-3);font-size:1.3em}
@container (max-width:720px){.flow .arr{display:none}}

.tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:.7em}
.tile{border:1px solid var(--border);border-radius:7px;padding:.75em .9em;display:grid;gap:.25em;align-content:start}
.tile b{font-weight:600}
.tile p{color:var(--text-2);font-size:.92em}
.tiles.three{grid-template-columns:repeat(3,1fr)}
@container (max-width:720px){.tiles,.tiles.three{grid-template-columns:1fr}}

table.roles{width:100%;border-collapse:collapse;font-size:.92em}
table.roles th,table.roles td{text-align:left;padding:.55em .7em;border-bottom:1px solid var(--border);vertical-align:top}
table.roles th{font-weight:600;font-size:.9em;color:var(--text-2)}
table.roles td:first-child{color:var(--text-2)}
.tw{overflow-x:auto}
@media (prefers-reduced-motion:reduce){.progress i{transition:none}}`;

export const TREINAMENTO_HTML = `<div class="app">
  <nav class="toc" aria-label="Índice">
    <h1>Treinamento CRM Gama</h1>
    <p class="sub">Prospecção · Pipeline · Tarefas · Empresas</p>
    <ol id="toc"></ol>
  </nav>

  <main>
    <div class="bar">
      <div class="left">
        <button class="btn-ui" id="prev" type="button">← Anterior</button>
        <button class="btn-ui" id="next" type="button">Próximo →</button>
        <span class="counter" id="count"></span>
      </div>
      <div class="left">
        <button class="btn-ui" id="modeOne" type="button" aria-pressed="true">Apresentação</button>
        <button class="btn-ui" id="modeAll" type="button" aria-pressed="false">Ver todos</button>
      </div>
    </div>
    <div class="progress"><i id="prog"></i></div>

    <div class="stage one" id="stage">

<!-- ============ ABERTURA ============ -->
<section class="slide cover" data-ch="intro" data-grp="Abertura" data-t="Capa">
  <div class="eyebrow"><span>Gama Brasil · Treinamento de usuários</span><span class="n"></span></div>
  <div>
    <h2>Como vender usando o CRM Gama</h2>
    <p class="lead">Do primeiro contato com a empresa até o fechamento — o passo a passo dos quatro menus do dia a dia.</p>
  </div>
  <div class="chips4">
    <span style="background:var(--c-prosp)">Prospecção</span>
    <span style="background:var(--c-pipe)">Pipeline</span>
    <span style="background:var(--c-tar)">Tarefas</span>
    <span style="background:var(--c-emp)">Empresas</span>
  </div>
</section>

<section class="slide" data-ch="intro" data-grp="Abertura" data-t="O caminho da venda">
  <div class="eyebrow"><span>Visão geral</span><span class="n"></span></div>
  <h2>O caminho de uma venda dentro do CRM</h2>
  <p class="lead">Cada menu é uma etapa. As tarefas acompanham a venda do começo ao fim.</p>
  <div class="stack">
    <div class="flow">
      <div class="st"><span class="k" style="color:var(--c-prosp)">Prospecção</span><b>Encontrar</b><p>Empresas com potencial. Pesquisa, classifica e faz o primeiro contato.</p></div>
      <div class="arr">→</div>
      <div class="st"><span class="k" style="color:var(--c-prosp)">Aprovar para Lead</span><b>Qualificar</b><p>Com CNPJ confirmado, o lead sai da triagem e vira empresa.</p></div>
      <div class="arr">→</div>
      <div class="st"><span class="k" style="color:var(--c-pipe)">Pipeline</span><b>Negociar</b><p>Oportunidade com valor, proposta e etapas até fechar ou perder.</p></div>
      <div class="arr">→</div>
      <div class="st"><span class="k" style="color:var(--c-emp)">Empresas</span><b>Relacionar</b><p>A ficha guarda tudo: contatos, histórico, vendas e pós-venda.</p></div>
    </div>
    <div class="flow">
      <div class="st" style="flex-basis:100%"><span class="k" style="color:var(--c-tar)">Tarefas · em todas as etapas</span><p>Ligação, e-mail, visita, proposta, follow-up e reunião — com prazo e responsável, pra nenhum retorno ficar esquecido.</p></div>
    </div>
  </div>
</section>

<section class="slide" data-ch="intro" data-grp="Abertura" data-t="Conhecendo a tela">
  <div class="eyebrow"><span>Visão geral</span><span class="n"></span></div>
  <h2>Conhecendo a tela</h2>
  <div class="body">
    <ul class="pts">
      <li><b>Menu lateral</b> — agrupado em Comercial (Painel, Prospecção, Pipeline, Tarefas, Carteira de clientes), Análise (Relatórios) e Administração. O número ao lado mostra o que está pendente.</li>
      <li><b>Busca do topo</b> — escolha <span class="ui">em Tarefas</span> (o nome da tela atual) para filtrar enquanto digita, ou <span class="ui">em todo o CRM</span> e aperte Enter para procurar em tudo.</li>
      <li><b>Fichas de Prospecção e Empresas</b> abrem numa gaveta à direita, sem sair da lista.</li>
      <li><b>Cards do Pipeline e tarefas</b> abrem numa janela por cima da tela.</li>
      <li><b>Letras maiúsculas</b> — razão social, cidade e demais textos do cadastro são padronizados automaticamente.</li>
    </ul>
    <div class="mock" aria-hidden="true">
      <div class="top"><b>Menu</b><span class="pill p-gray">buscar… · nesta tela ▾</span></div>
      <table class="m-table">
        <tr><td colspan="2"><small>COMERCIAL</small></td></tr>
        <tr><td>Painel</td><td></td></tr>
        <tr><td style="font-weight:600">Prospecção</td><td style="text-align:right"><span class="pill p-gray">42</span></td></tr>
        <tr><td>Pipeline</td><td style="text-align:right"><span class="pill p-gray">12</span></td></tr>
        <tr><td>Tarefas</td><td style="text-align:right"><span class="pill p-gray">7</span></td></tr>
        <tr><td colspan="2"><small>CADASTROS</small></td></tr>
        <tr><td>Empresas</td><td style="text-align:right"><span class="pill p-gray">310</span></td></tr>
      </table>
    </div>
  </div>
</section>

<section class="slide" data-ch="intro" data-grp="Abertura" data-t="O que cada um vê">
  <div class="eyebrow"><span>Visão geral</span><span class="n"></span></div>
  <h2>O que cada pessoa enxerga</h2>
  <p class="lead">O CRM mostra a cada um só o que é dele. Se faltar algo, o gerente ajusta as permissões em Membros.</p>
  <div class="tw">
  <table class="roles">
    <tr><th></th><th>Representante</th><th>Gerente</th><th>Administrador</th></tr>
    <tr><td>Leads, oportunidades e tarefas</td><td>Só os próprios</td><td>Os próprios e os da equipe</td><td>Todos</td></tr>
    <tr><td>Empresas</td><td>As próprias e as que têm oportunidade dele</td><td>Todas</td><td>Todas</td></tr>
    <tr><td>Botão Excluir</td><td>Não aparece</td><td>Aparece</td><td>Aparece</td></tr>
    <tr><td>Vendas, ABC de Produtos e Serviços na ficha</td><td>Escondidas</td><td>Visíveis</td><td>Visíveis</td></tr>
    <tr><td>Editar ou remover contato</td><td>Só cadastra</td><td>Só cadastra</td><td>Edita e remove</td></tr>
  </table>
  </div>
</section>

<!-- ============ PROSPECÇÃO ============ -->
<section class="slide divider" data-ch="prosp" data-grp="Prospecção" data-t="Abertura do módulo">
  <div class="path">Menu Comercial › Prospecção</div>
  <h2>Prospecção</h2>
  <p class="lead">Onde ficam as empresas com potencial que ainda estão em triagem. Aqui se pesquisa, classifica, faz o primeiro contato e decide: aprovar ou descartar.</p>
</section>

<section class="slide" data-ch="prosp" data-grp="Prospecção" data-t="A lista de prospecção">
  <div class="eyebrow"><span>Prospecção</span><span class="n"></span></div>
  <h2>A lista de prospecção</h2>
  <div class="body wide">
    <div class="mock" aria-hidden="true">
      <div class="top"><b>Prospecção</b><span><span class="m-btn ghost">Importar planilha</span> <span class="m-btn">Nova empresa</span></span></div>
      <div class="m-tabs"><span class="on">Todos</span><span>Curto Prazo</span><span>Médio Prazo</span><span>Longo Prazo</span><span>Descartados</span></div>
      <table class="m-table">
        <tr><th>Empresa</th><th>Segmento</th><th>Classificação</th><th>Ação</th></tr>
        <tr><td>METALÚRGICA EXEMPLO LTDA<small>00.000.000/0001-00 · CAMPINAS/SP</small></td><td>Indústria</td><td><span class="pill p-hot">Curto Prazo</span></td><td>📄 ✓ ✕</td></tr>
        <tr><td>COMERCIAL MODELO S.A.<small>sem CNPJ · CURITIBA/PR</small></td><td>Varejo</td><td><span class="pill p-mid">Médio Prazo</span></td><td>📄 ✓ ✕</td></tr>
        <tr><td>DISTRIBUIDORA FICTÍCIA ME<small>00.000.000/0002-00 · RECIFE/PE</small></td><td>—</td><td><span class="pill p-gray">Sem classificação</span></td><td>📄 ✓ ✕</td></tr>
      </table>
    </div>
    <ul class="pts">
      <li><b>Classificação</b> — escolha direto na linha: <span class="ui">Curto Prazo</span> (quente), <span class="ui">Médio Prazo</span> (morno) ou <span class="ui">Longo Prazo</span> (frio).</li>
      <li><b>Segmento e Tags</b> — também editáveis direto na linha. Use os filtros de tag e segmento acima da tabela.</li>
      <li><b>Ícones da coluna Ação</b> — 📄 abre a ficha, ✓ aprova, ✕ descarta.</li>
      <li><b>Em lote</b> — marque várias linhas e use <span class="ui">Editar em lote</span>, <span class="ui">Descartar</span> ou <span class="ui">Aprovar para Lead</span>.</li>
      <li><b>Situação diferente de ATIVA</b> aparece em vermelho, e empresas em recuperação judicial ganham aviso ⚠.</li>
    </ul>
  </div>
</section>

<section class="slide" data-ch="prosp" data-grp="Prospecção" data-t="Cadastrar uma empresa">
  <div class="eyebrow"><span>Prospecção</span><span class="n"></span></div>
  <h2>Cadastrar uma empresa nova</h2>
  <div class="body">
    <ol class="steps">
      <li><span>Clique em <span class="ui">Nova empresa</span>. A ficha abre na aba Dados cadastrais.</span></li>
      <li><span>Digite o CNPJ (14 dígitos) e clique em <span class="ui">Consultar Receita</span>. Razão social, CNAE, porte, situação e cidade são preenchidos sozinhos.</span></li>
      <li><span>Confira os dados. Só a <b>Razão social</b> é obrigatória.</span></li>
      <li><span>Clique em <span class="ui">✓ Salvar registro</span>. Só depois disso as abas de Timeline, Contatos e Tarefas destravam.</span></li>
    </ol>
    <div class="stack">
      <div class="mock" aria-hidden="true">
        <div class="top"><b>Prospecção · triagem</b><span class="pill p-gray">não salvo</span></div>
        <div class="m-tabs"><span class="lock">🔒 Timeline</span><span class="on">Dados cadastrais</span><span class="lock">🔒 Contatos</span><span class="lock">🔒 Tarefas</span></div>
        <div class="m-row"><span style="flex:1" class="m-field"><span class="v" style="display:block">00.000.000/0001-00</span></span><span class="m-btn ghost">Consultar Receita</span></div>
        <div class="m-field"><div class="l">Razão social*</div><div class="v">METALÚRGICA EXEMPLO LTDA</div></div>
        <div class="m-foot"><span></span><div><span class="m-btn">✓ Salvar registro</span></div></div>
      </div>
      <div class="note"><b>Dica:</b> sem CNPJ a empresa entra na triagem, mas <b>não pode ser aprovada</b>. Quanto antes o CNPJ, melhor.</div>
    </div>
  </div>
</section>

<section class="slide" data-ch="prosp" data-grp="Prospecção" data-t="Importar planilha">
  <div class="eyebrow"><span>Prospecção</span><span class="n"></span></div>
  <h2>Importar muitas empresas de uma vez</h2>
  <div class="body">
    <ol class="steps">
      <li><span>Clique em <span class="ui">Importar planilha</span> e depois em <span class="ui">Copiar modelo de cabeçalho</span>.</span></li>
      <li><span>Cole na célula A1 do Excel ou do Google Planilhas e preencha.</span></li>
      <li><span>Salve como <b>.xlsx</b> ou <b>.csv</b>, escolha o arquivo e clique em <span class="ui">Importar planilha com contatos</span>.</span></li>
      <li><span>Confira o resultado: quantos contatos entraram e o motivo de cada linha recusada.</span></li>
    </ol>
    <div class="stack">
      <div class="note"><b>Uma linha = um contato.</b> Empresa com três contatos ocupa três linhas, repetindo o mesmo CNPJ.</div>
      <div class="note bad"><b>Não crie colunas novas</b> nem renomeie as do modelo — qualquer coluna diferente trava a importação inteira.</div>
      <div class="note"><b>Representante.</b> Escreva o nome, o login ou o e-mail de quem fica com o lead — o supervisor dele entra junto na equipe de vendas da empresa. Em branco, o lead fica com você. Distribuir para outra pessoa é permitido a gerente, administrador e proprietário.</div>
      <div><div class="label">Colunas do modelo</div><p style="color:var(--text-2);font-size:.88em;line-height:1.6">CNPJ · Razão Social · Fantasia · Cidade · UF · CNAE · Porte · Situação Cadastral · Abertura · Representante · Tags · Contato Nome · Contato Cargo · Contato Email · Contato Telefone · Contato Decisor</p></div>
    </div>
  </div>
</section>

<section class="slide" data-ch="prosp" data-grp="Prospecção" data-t="A ficha do lead">
  <div class="eyebrow"><span>Prospecção</span><span class="n"></span></div>
  <h2>A ficha do lead</h2>
  <div class="body wide">
    <div class="mock" aria-hidden="true">
      <div class="top"><b>METALÚRGICA EXEMPLO LTDA</b><span><span class="m-btn red">Descartar</span> <span class="m-btn green">Aprovar para Lead</span></span></div>
      <div class="m-tabs"><span class="on">Timeline 3</span><span>Dados cadastrais</span><span>Contatos 2</span><span>Tarefas 1</span></div>
      <div class="m-row"><span class="pill p-cold">Anotação</span><span class="pill p-gray">Ligação</span><span class="pill p-gray">Reunião</span><span class="pill p-gray">Visita</span><span class="pill p-gray">E-mail</span></div>
      <div class="m-field"><div class="v">Registrar contato com este lead…</div></div>
      <div class="m-row" style="justify-content:flex-end"><span class="m-btn">Registrar</span></div>
    </div>
    <ul class="pts">
      <li><b>Timeline</b> — tudo o que foi conversado. O histórico fica guardado mesmo antes de aprovar.</li>
      <li><b>Dados cadastrais</b> — dados da Receita, segmento, tags e classificação. Dá pra completar o CNPJ aqui.</li>
      <li><b>Contatos</b> — nome (obrigatório), cargo, e-mail, telefone e se é <b>tomador de decisão</b>.</li>
      <li><b>Tarefas</b> — <span class="ui">Criar tarefa</span> já vinculada a esta empresa.</li>
    </ul>
  </div>
</section>

<section class="slide" data-ch="prosp" data-grp="Prospecção" data-t="Registrar um contato">
  <div class="eyebrow"><span>Prospecção</span><span class="n"></span></div>
  <h2>Registrar cada conversa na Timeline</h2>
  <div class="body">
    <ol class="steps">
      <li><span>Na ficha, aba <b>Timeline</b>, escolha o tipo: Anotação, Ligação, Reunião, Visita ou E-mail.</span></li>
      <li><span>Em Ligação, Reunião, Visita e E-mail, <b>escolha com quem falou</b>. Se a empresa não tem contato, use <span class="ui">+ Cadastrar contato</span>.</span></li>
      <li><span>Escreva o que foi conversado e os próximos passos.</span></li>
      <li><span>Clique em <span class="ui">Registrar</span>. O registro mostra tipo, autor, contato, data e hora.</span></li>
    </ol>
    <div class="stack">
      <div class="note good"><b>Por que registrar?</b> Quem pegar a empresa depois — você mesmo daqui a três meses ou um colega — sabe exatamente onde a conversa parou.</div>
      <div class="note"><b>Anotação</b> é o único tipo que não pede contato: use para observações internas.</div>
    </div>
  </div>
</section>

<section class="slide" data-ch="prosp" data-grp="Prospecção" data-t="Aprovar ou descartar">
  <div class="eyebrow"><span>Prospecção</span><span class="n"></span></div>
  <h2>Aprovar ou descartar</h2>
  <div class="body">
    <div class="stack">
      <div class="label">Aprovar para Lead</div>
      <ol class="steps">
        <li><span>Confirme que o CNPJ está preenchido.</span></li>
        <li><span>Clique em <span class="ui">Aprovar para Lead</span>.</span></li>
        <li><span>O CRM pergunta se quer cadastrar uma oportunidade agora. <span class="ui">Sim</span> abre a Nova oportunidade com a empresa já escolhida.</span></li>
      </ol>
      <p style="color:var(--text-2);font-size:.93em">A empresa sai da triagem e passa a aparecer em <b>Empresas</b> como Lead — com histórico e tarefas preservados.</p>
    </div>
    <div class="stack">
      <div class="label">Descartar</div>
      <p>O lead vai para a aba <b>Descartados</b> (só consulta) e não volta para a triagem.</p>
      <div class="label" style="margin-top:.6em">Avisos que bloqueiam a aprovação</div>
      <div class="note bad">“Preencha o CNPJ do lead antes de aprovar”</div>
      <div class="note bad">“Este CNPJ já está cadastrado em Empresas” — descarte o lead e trabalhe pela ficha da empresa que já existe.</div>
    </div>
  </div>
</section>

<!-- ============ PIPELINE ============ -->
<section class="slide divider" data-ch="pipe" data-grp="Pipeline" data-t="Abertura do módulo">
  <div class="path">Menu Comercial › Pipeline</div>
  <h2>Pipeline</h2>
  <p class="lead">O quadro das negociações em andamento. Cada card é uma oportunidade com valor, que anda da solicitação da proposta até o fechamento.</p>
</section>

<section class="slide" data-ch="pipe" data-grp="Pipeline" data-t="O quadro">
  <div class="eyebrow"><span>Pipeline</span><span class="n"></span></div>
  <h2>O quadro de oportunidades</h2>
  <div class="kanban" aria-hidden="true">
    <div class="kcol"><h4>Solicitação de Propostas<small>2 · R$ 48.000</small></h4>
      <div class="kcard"><span class="sla">2d</span><b>METALÚRGICA EXEMPLO</b><span class="meta">Representante A</span><span class="meta">Aberta 10/09 · Previsão 30/10</span><span class="val">R$ 30.000</span></div>
      <div class="kcard"><span class="sla">1d</span><b>COMERCIAL MODELO</b><span class="meta">Representante B</span><span class="val">R$ 18.000</span></div>
    </div>
    <div class="kcol"><h4>Elaboração de Propostas<small>1 · R$ 72.500</small></h4>
      <div class="kcard"><span class="sla">4d</span><b>INDÚSTRIA DEMONSTRAÇÃO</b><span class="meta">Representante A</span><span class="val">R$ 72.500</span><span class="pend">⚠ Pendência para você</span></div>
    </div>
    <div class="kcol"><h4>Aprovação de Propostas<small>0 · R$ 0</small></h4><p style="color:var(--text-3);margin:0">Vazio</p></div>
    <div class="kcol"><h4>Negociação e Fechamento<small>1 · R$ 120.000</small></h4>
      <div class="kcard"><b>DISTRIBUIDORA FICTÍCIA</b><span class="meta">Representante C</span><span class="meta">Previsão 25/09</span><span class="val">R$ 120.000</span></div>
    </div>
  </div>
  <div class="tiles three">
    <div class="tile"><b>Selo “Nd”</b><p>Dias úteis de SLA da proposta. Conta sozinho e para quando o card chega em Negociação.</p></div>
    <div class="tile"><b>⚠ Pendência</b><p>Alguém te destacou num comentário e espera sua resposta.</p></div>
    <div class="tile"><b>Topo da coluna</b><p>Quantidade de cards e soma dos valores da etapa.</p></div>
  </div>
</section>

<section class="slide" data-ch="pipe" data-grp="Pipeline" data-t="Nova oportunidade">
  <div class="eyebrow"><span>Pipeline</span><span class="n"></span></div>
  <h2>Criar uma oportunidade</h2>
  <div class="body">
    <ol class="steps">
      <li><span>Clique em <span class="ui">Nova oportunidade</span> (ou responda <span class="ui">Sim</span> ao aprovar um lead).</span></li>
      <li><span><b>Empresa</b> — busque por nome ou CNPJ. Não achou? Use <span class="ui">Cadastrar como empresa nova</span> sem sair da tela.</span></li>
      <li><span><b>Valor</b> (obrigatório), <b>Previsão</b> de fechamento e <b>Descrição</b> do que está sendo negociado.</span></li>
      <li><span>Opcional: anexos, itens, primeiro comentário e uma tarefa já vinculada.</span></li>
      <li><span>Clique em <span class="ui">Criar oportunidade</span>. O card nasce na primeira etapa.</span></li>
    </ol>
    <div class="stack">
      <div class="mock" aria-hidden="true">
        <div class="top"><b>Nova oportunidade</b></div>
        <div class="m-field"><div class="l">Empresa *</div><div class="v">Buscar empresa ou lead por nome/CNPJ…</div></div>
        <div class="m-row" style="padding:0"><div class="m-field" style="flex:1"><div class="l">Valor</div><div class="v">R$ 30.000,00</div></div><div class="m-field" style="flex:1"><div class="l">Previsão</div><div class="v">30/10/2026</div></div></div>
        <div class="m-field"><div class="l">Itens</div><div class="v">Novo item + Enter</div></div>
        <div class="m-foot"><span class="m-btn ghost">Fechar</span><div><span class="m-btn">Criar oportunidade</span></div></div>
      </div>
      <div class="note"><b>Itens</b> são os produtos da proposta. Com valor nos itens, o valor do card passa a ser a soma deles.</div>
    </div>
  </div>
</section>

<section class="slide" data-ch="pipe" data-grp="Pipeline" data-t="Mover os cards">
  <div class="eyebrow"><span>Pipeline</span><span class="n"></span></div>
  <h2>Mover o card entre as etapas</h2>
  <div class="body">
    <ul class="pts">
      <li><b>Arraste para outra coluna</b> para mudar a etapa. A etapa não é editada dentro do card, só no quadro.</li>
      <li><b>Arraste dentro da mesma coluna</b> para mudar a prioridade — a ordem vale também nos e-mails de resumo.</li>
      <li><b>O SLA é automático.</b> Ninguém digita prazo: ele conta desde a solicitação e para ao entrar em Negociação e Fechamento.</li>
    </ul>
    <div class="stack">
      <div class="label">Voltou de Negociação para Proposta?</div>
      <p>O CRM pergunta <b>“Por que a proposta voltou?”</b></p>
      <div class="tile"><b>Erro na elaboração da proposta</b><p>O SLA continua de onde estava.</p></div>
      <div class="tile"><b>Solicitação de alteração pelo cliente</b><p>O SLA recomeça a contar a partir de hoje.</p></div>
      <p style="color:var(--text-2);font-size:.9em"><span class="ui">Cancelar</span> devolve o card para onde estava.</p>
    </div>
  </div>
</section>

<section class="slide" data-ch="pipe" data-grp="Pipeline" data-t="Dentro do card">
  <div class="eyebrow"><span>Pipeline</span><span class="n"></span></div>
  <h2>Dentro do card</h2>
  <div class="body">
    <div class="tiles">
      <div class="tile"><b>Dados</b><p>Representante, valor, previsão de fechamento e descrição. Edite e clique em <span class="ui">Salvar</span>.</p></div>
      <div class="tile"><b>Anexos</b><p><span class="ui">+ Anexar arquivo</span> aceita vários. Imagem e PDF abrem em prévia.</p></div>
      <div class="tile"><b>Itens</b><p>Lista lateral com valor por item e total no rodapé.</p></div>
      <div class="tile"><b>Mais ações</b><p>Gerar tarefa, ver histórico de mudanças, fechar, perder ou reabrir.</p></div>
    </div>
    <div class="stack">
      <div class="label">Comentários — a conversa da equipe</div>
      <ul class="pts">
        <li><b>@ Destacar membro</b> — cria uma pendência para a pessoa. Só ela dá baixa em <span class="ui">✓ Resolver pendência</span>.</li>
        <li><b>📌 Fixar</b> — mantém o recado importante no topo.</li>
        <li><b>🛒 Carimbar itens</b> — marca de qual produto o comentário fala.</li>
        <li><b>Histórico de anotações</b> — o balão no topo do Pipeline junta os comentários de todos os seus cards, com lidos e não lidos.</li>
      </ul>
    </div>
  </div>
</section>

<section class="slide" data-ch="pipe" data-grp="Pipeline" data-t="Fechar ou perder">
  <div class="eyebrow"><span>Pipeline</span><span class="n"></span></div>
  <h2>Fechar ou perder a oportunidade</h2>
  <div class="body">
    <ol class="steps">
      <li><span>Leve o card até <b>Negociação e Fechamento</b> — só nessa etapa as opções aparecem.</span></li>
      <li><span>Abra o card e clique em <span class="ui">Mais ações</span>.</span></li>
      <li><span><span class="ui">✓ Marcar Fechada</span> — venda ganha. 🎉</span></li>
      <li><span><span class="ui">✕ Marcar Perdida</span> — escolha o motivo. Se não houver um adequado, use <span class="ui">+ Novo motivo</span>.</span></li>
      <li><span>Errou? <span class="ui">↩ Reabrir</span> devolve a oportunidade ao quadro.</span></li>
    </ol>
    <div class="stack">
      <div class="label">Oportunidades encerradas</div>
      <p>Abaixo do quadro, mês a mês (ou num período que você escolher):</p>
      <div class="tiles">
        <div class="tile"><span class="pill p-cold" style="justify-self:start">Fechada</span><p>Azul — venda ganha.</p></div>
        <div class="tile"><span class="pill p-hot" style="justify-self:start">Perdida</span><p>Vermelho — com o motivo.</p></div>
      </div>
      <div class="note good">O motivo da perda é o que permite à empresa entender <b>por que</b> não vendeu. Escolha com cuidado.</div>
    </div>
  </div>
</section>

<!-- ============ TAREFAS ============ -->
<section class="slide divider" data-ch="tar" data-grp="Tarefas" data-t="Abertura do módulo">
  <div class="path">Menu Comercial › Tarefas</div>
  <h2>Tarefas</h2>
  <p class="lead">A sua rotina num lugar só: o que fazer, com quem e até quando.</p>
</section>

<section class="slide" data-ch="tar" data-grp="Tarefas" data-t="Tabela e Calendário">
  <div class="eyebrow"><span>Tarefas</span><span class="n"></span></div>
  <h2>Duas formas de ver a rotina</h2>
  <div class="body wide">
    <div class="mock" aria-hidden="true">
      <div class="top"><b><span class="m-btn">Tabela</span> <span class="m-btn ghost">Calendário</span></b><span class="m-btn">Nova tarefa</span></div>
      <table class="m-table">
        <tr><th></th><th>Tarefa</th><th>Tipo</th><th>Prazo</th><th>Situação</th></tr>
        <tr><td>○</td><td>Retornar sobre a proposta<small>METALÚRGICA EXEMPLO</small></td><td>Ligação</td><td style="color:var(--danger);font-weight:600">15/09</td><td><span class="pill p-gray">Pendente</span></td></tr>
        <tr><td>○</td><td>Apresentar linha nova<small>COMERCIAL MODELO</small></td><td>Visita</td><td style="color:var(--accent);font-weight:600">hoje</td><td><span class="pill p-gray">Pendente</span></td></tr>
        <tr><td style="color:var(--ok)">●</td><td>Enviar catálogo<small>INDÚSTRIA DEMONSTRAÇÃO</small></td><td>E-mail</td><td>12/09</td><td><span class="pill p-ok">Concluída</span></td></tr>
      </table>
    </div>
    <div class="stack">
      <div class="tile"><b>Tabela</b><p>Pendentes primeiro, pelo prazo mais próximo. Prazo vencido aparece destacado. Clique na linha para abrir.</p></div>
      <div class="tile"><b>Calendário</b><p>Visão do mês. <b>Arraste um card para outro dia</b> para mudar o prazo. Oportunidades em Negociação também aparecem, pela previsão de fechamento.</p></div>
      <div class="tile"><b>Bolinha à esquerda</b><p>Conclui ou reabre a tarefa sem abrir a ficha.</p></div>
    </div>
  </div>
</section>

<section class="slide" data-ch="tar" data-grp="Tarefas" data-t="Nova tarefa">
  <div class="eyebrow"><span>Tarefas</span><span class="n"></span></div>
  <h2>Criar uma tarefa</h2>
  <div class="body">
    <ol class="steps">
      <li><span>Clique em <span class="ui">Nova tarefa</span> — ou crie pela ficha do lead ou pelo card da oportunidade, que já vêm vinculados.</span></li>
      <li><span><b>Descrição</b> — o que precisa ser feito.</span></li>
      <li><span><b>Empresa</b>, <b>Tipo</b> e <b>Prazo</b>.</span></li>
      <li><span><b>Responsável</b> — você mesmo ou o seu gerente.</span></li>
      <li><span>Opcional: comentário inicial e anexo. Clique em <span class="ui">Criar tarefa</span>.</span></li>
    </ol>
    <div class="stack">
      <div class="label">Os 6 tipos de tarefa</div>
      <div class="m-row" style="padding:0"><span class="pill p-cold">Ligação</span><span class="pill p-cold">E-mail</span><span class="pill p-cold">Visita</span><span class="pill p-cold">Reunião</span><span class="pill p-gray">Proposta</span><span class="pill p-gray">Follow-up</span></div>
      <div class="note"><b>Ligação, E-mail, Visita e Reunião</b> exigem escolher o <b>contato</b>. Se a empresa não tem nenhum, dá para cadastrar ali mesmo.</div>
    </div>
  </div>
</section>

<section class="slide" data-ch="tar" data-grp="Tarefas" data-t="Concluir e acompanhar">
  <div class="eyebrow"><span>Tarefas</span><span class="n"></span></div>
  <h2>Acompanhar e concluir</h2>
  <div class="body wide">
    <div class="mock" aria-hidden="true">
      <div class="top"><b>Retornar sobre a proposta</b><span class="pill p-gray">Pendente</span></div>
      <div class="m-row" style="color:var(--text-3)">Empresa: METALÚRGICA EXEMPLO · Inserido por Representante A</div>
      <div class="m-row" style="padding-top:0"><div class="m-field" style="flex:1;padding:0"><div class="l">Tipo</div><div class="v">Ligação</div></div><div class="m-field" style="flex:1;padding:0"><div class="l">Prazo</div><div class="v">15/09/2026</div></div></div>
      <div class="m-field"><div class="l">Comentários · 1</div><div class="v">Escrever comentário…</div></div>
      <div class="m-foot"><span class="m-btn green">Concluir</span><div><span class="m-btn ghost">Fechar</span><span class="m-btn">Salvar</span></div></div>
    </div>
    <ul class="pts">
      <li><b>Mudou algo?</b> Altere tipo, contato, prazo ou responsável e clique em <span class="ui">Salvar</span>.</li>
      <li><b>Anexos e comentários</b> registram o andamento sem criar outra tarefa.</li>
      <li><b>Fez?</b> Clique em <span class="ui">Concluir</span>. Precisou voltar? <span class="ui">Reabrir</span>.</li>
      <li><b>Excluir</b> só aparece para gerente e administrador, e toda exclusão fica registrada.</li>
    </ul>
  </div>
</section>

<!-- ============ EMPRESAS ============ -->
<section class="slide divider" data-ch="emp" data-grp="Empresas" data-t="Abertura do módulo">
  <div class="path">Menu Comercial › Carteira de clientes</div>
  <h2>Empresas</h2>
  <p class="lead">A carteira: leads aprovados e clientes, com tudo o que aconteceu com cada um — contatos, conversas, oportunidades e compras.</p>
</section>

<section class="slide" data-ch="emp" data-grp="Empresas" data-t="A lista de empresas">
  <div class="eyebrow"><span>Empresas</span><span class="n"></span></div>
  <h2>A lista de empresas</h2>
  <div class="body wide">
    <div class="mock" aria-hidden="true">
      <div class="top"><b><span class="m-btn">Todas</span> <span class="m-btn ghost">Leads</span> <span class="m-btn ghost">Clientes</span></b><span class="m-btn">+ Nova empresa</span></div>
      <table class="m-table">
        <tr><th>Empresa</th><th>Tipo</th><th>eGestor</th><th>Classe</th><th>Última compra</th></tr>
        <tr><td>INDÚSTRIA DEMONSTRAÇÃO LTDA<small>00.000.000/0003-00</small></td><td><span class="pill p-ok">Cliente</span></td><td style="color:var(--ok)">✓</td><td><b>A</b></td><td>02/09/2026</td></tr>
        <tr><td>COMERCIAL MODELO S.A.<small>00.000.000/0004-00</small></td><td><span class="pill p-ok">Cliente</span></td><td style="color:var(--ok)">✓</td><td><b>C</b></td><td>18/03/2026</td></tr>
        <tr><td>METALÚRGICA EXEMPLO LTDA<small>00.000.000/0001-00</small></td><td><span class="pill p-gray">Lead</span></td><td style="color:var(--text-3)">✗</td><td>—</td><td>—</td></tr>
      </table>
    </div>
    <ul class="pts">
      <li><b>Lead ou Cliente</b> — cliente é quem já compra. Filtre pelos botões do topo.</li>
      <li><b>eGestor ✓</b> — empresa ligada ao sistema de faturamento.</li>
      <li><b>Classe A, B ou C</b> — curva ABC: A são os clientes que somam os primeiros 80% do faturamento, B os 15% seguintes, C o restante.</li>
      <li><b>LTV e Última compra</b> — quanto o cliente já comprou e quando foi a última vez.</li>
      <li>Clique no título de qualquer coluna para ordenar.</li>
    </ul>
  </div>
</section>

<section class="slide" data-ch="emp" data-grp="Empresas" data-t="A ficha da empresa">
  <div class="eyebrow"><span>Empresas</span><span class="n"></span></div>
  <h2>A ficha da empresa</h2>
  <p class="lead">Tudo sobre o cliente em abas, sem sair da lista.</p>
  <div class="tiles three">
    <div class="tile"><b>Visão geral</b><p>Quanto já ganhou, o que está em negociação, interações e tarefas abertas.</p></div>
    <div class="tile"><b>Dados cadastrais</b><p>Dados da Receita, inscrição estadual e botão <span class="ui">Editar</span>.</p></div>
    <div class="tile"><b>Contatos</b><p>Pessoas da empresa, marcando quem é tomador de decisão.</p></div>
    <div class="tile"><b>Timeline</b><p>Conversas registradas. Aqui existe também o tipo <b>Pós-venda</b>.</p></div>
    <div class="tile"><b>Tarefas e Oportunidades</b><p>Tudo o que está ligado a esta empresa, aberto ou encerrado.</p></div>
    <div class="tile"><b>Vendas, Pós-venda, ABC de Produtos, Serviços</b><p>O que o cliente comprou e o que mais compra. Algumas abas dependem de permissão.</p></div>
  </div>
</section>

<section class="slide" data-ch="emp" data-grp="Empresas" data-t="Cadastro e eGestor">
  <div class="eyebrow"><span>Empresas</span><span class="n"></span></div>
  <h2>Cadastrar e manter os dados em dia</h2>
  <div class="body">
    <div class="stack">
      <div class="label">Cadastrar</div>
      <ol class="steps">
        <li><span><span class="ui">+ Nova empresa</span>, digite o CNPJ e <span class="ui">Consultar Receita</span>.</span></li>
        <li><span>Confira identificação, contato e endereço. Preencha ao menos razão social ou fantasia.</span></li>
        <li><span><span class="ui">✓ Salvar registro</span> destrava Contatos e Timeline.</span></li>
      </ol>
    </div>
    <div class="stack">
      <div class="note good"><b>CNPJ já cadastrado por um colega?</b> O CRM não duplica: você passa a ver a empresa, mas o histórico, as tarefas e as oportunidades de cada um continuam separados.</div>
      <div class="note"><b>Empresa integrada ao eGestor:</b> ao salvar o cadastro, a alteração vai também para o eGestor (Matriz e Filial). A mensagem na tela confirma se deu certo.</div>
      <div class="note bad"><b>Registre as conversas na Timeline</b> e não em outro lugar. É ali que a equipe acompanha.</div>
    </div>
  </div>
</section>

<!-- ============ FECHAMENTO ============ -->
<section class="slide" data-ch="intro" data-grp="Encerramento" data-t="Rotina diária">
  <div class="eyebrow"><span>Resumo</span><span class="n"></span></div>
  <h2>Uma rotina simples, todo dia</h2>
  <div class="body">
    <ol class="steps">
      <li><span><b>Abra Tarefas</b> e resolva primeiro o que está vencido e o que vence hoje.</span></li>
      <li><span><b>Olhe o Pipeline</b>: pendências ⚠ para você e cards parados há muitos dias.</span></li>
      <li><span><b>Registre cada contato</b> na Timeline assim que desligar o telefone.</span></li>
      <li><span><b>Toda conversa termina com uma próxima tarefa</b> — com prazo.</span></li>
      <li><span><b>Trabalhe a Prospecção</b>: classifique, complete o CNPJ e aprove ou descarte.</span></li>
    </ol>
    <div class="stack">
      <div class="label">Os três erros mais comuns</div>
      <div class="note bad">Conversa que não foi registrada — para o CRM, ela não aconteceu.</div>
      <div class="note bad">Oportunidade parada no quadro depois de ganha ou perdida. Encerre com o motivo.</div>
      <div class="note bad">Ligação ou visita sem contato escolhido. Cadastre as pessoas da empresa.</div>
    </div>
  </div>
</section>

<section class="slide cover" data-ch="intro" data-grp="Encerramento" data-t="Dúvidas">
  <div class="eyebrow"><span>Encerramento</span><span class="n"></span></div>
  <div>
    <h2>Dúvidas?</h2>
    <p class="lead">Este material fica disponível no próprio CRM, no menu Treinamento, para consultar sempre que precisar.</p>
  </div>
  <div class="chips4">
    <span style="background:var(--c-prosp)">Prospecção</span>
    <span style="background:var(--c-pipe)">Pipeline</span>
    <span style="background:var(--c-tar)">Tarefas</span>
    <span style="background:var(--c-emp)">Empresas</span>
  </div>
</section>

    </div>
  </main>
</div>`;
