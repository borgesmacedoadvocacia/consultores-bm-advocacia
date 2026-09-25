/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Entrada do web app
 * ----------------------------------------------------------------------------
 *  Serve a interface (HtmlService). Todo o resto do sistema é chamado pelo
 *  navegador via google.script.run, sempre com o token de sessão.
 *
 *  A chave da API nunca sai daqui: o navegador fala com o Apps Script, e só o
 *  Apps Script fala com a API do Claude.
 * ============================================================================
 */

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.APP_NOME = APP.nome;
  t.APP_VERSAO = APP.versao;
  t.ESCRITORIO = APP.escritorio;
  return t.evaluate()
    .setTitle(APP.nome)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Usado pelos <?!= incluir('Estilo') ?> do Index.html. */
function incluir(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

/**
 * Diagnóstico para a tela de ajuda: diz o que está configurado sem revelar
 * segredo nenhum (a chave aparece só como "configurada: sim/não").
 */
function diagnostico(token) {
  exigirSessao_(token);
  var p = props_();
  var linhas = [];
  linhas.push({ item: 'Modelo', valor: modelo_() });
  linhas.push({ item: 'Chave da API', valor: p.getProperty('ANTHROPIC_API_KEY') ? 'configurada' : 'FALTANDO' });
  linhas.push({ item: 'Usuários cadastrados', valor: String(lerUsuarios_().length) });

  CONSULTORES.forEach(function (c) {
    var v;
    try {
      var pasta = resolverPastaConsultor(c.id);
      var idx = acervoIndice_(c.id);
      v = pasta.getName() + ' — ' + idx.total + ' arquivos';
    } catch (e) {
      v = 'ERRO: ' + e.message;
    }
    linhas.push({ item: c.curto, valor: v });
  });

  var fila = lerJobs_(function (j) { return j.situacao === 'fila' || j.situacao === 'rodando'; });
  linhas.push({ item: 'Pesquisas na fila', valor: String(fila.length) });
  return linhas;
}
