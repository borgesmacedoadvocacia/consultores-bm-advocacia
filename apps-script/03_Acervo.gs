/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Acervo (a pasta do Drive de cada consultor)
 * ----------------------------------------------------------------------------
 *  Este arquivo é o único caminho do sistema para o conteúdo do acervo:
 *   - indexa a pasta (recursivamente) e mantém o índice em cache;
 *   - busca por termos no caminho e no conteúdo dos arquivos de texto;
 *   - lê um arquivo (convertendo PDF, DOCX, XLSX e arquivos do Google);
 *   - grava novos arquivos (anexos do operador e dossiês de pesquisa).
 *
 *  Nada é inventado aqui: o que a busca não achar, o consultor não vai saber.
 * ============================================================================
 */

var ACERVO = {
  ttlIndiceSeg: 3 * 3600,
  maxArquivosIndice: 4000,
  maxProfundidade: 8,
  maxLeiturasPorBusca: 45,
  maxCharsLeitura: 40000,
  maxBytesTextoDireto: 3 * 1024 * 1024,
  maxCharsArvore: 12000
};

/* Extensões/MIME que dá para ler como texto direto. */
var MIME_TEXTO = [
  'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values',
  'application/json', 'text/html', 'text/xml', 'application/xml',
  'text/x-python', 'application/javascript', 'text/yaml'
];

function ehTexto_(mime, nome) {
  if (MIME_TEXTO.indexOf(mime) >= 0) return true;
  return /\.(md|markdown|txt|csv|tsv|json|ya?ml|html?|xml|py|gs|js|sql|log|ini|cfg)$/i
    .test(nome || '');
}

/* ---------------------------- índice da pasta ---------------------------- */

/**
 * Índice do acervo: um registro por arquivo, com caminho relativo à pasta do
 * consultor. Usa cache (3h) e, como rede de segurança, o arquivo
 * _app/indice.json — que também serve de histórico do que existia.
 */
function acervoIndice_(consultorId, forcar) {
  var chave = 'idx_' + consultorId;
  if (!forcar) {
    var doCache = lerCacheGrande_(chave);
    if (doCache) return doCache;
  }

  var raiz = resolverPastaConsultor(consultorId);
  var arquivos = [];
  var ignorar = [normalizar_(APP.pastaApp)];

  (function varrer(pasta, prefixo, nivel) {
    if (nivel > ACERVO.maxProfundidade || arquivos.length >= ACERVO.maxArquivosIndice) return;

    var fit = pasta.getFiles();
    while (fit.hasNext() && arquivos.length < ACERVO.maxArquivosIndice) {
      var f = fit.next();
      var nome = f.getName();
      if (nome === 'desktop.ini' || nome.indexOf('~$') === 0) continue;
      arquivos.push({
        id: f.getId(),
        nome: nome,
        caminho: prefixo + nome,
        mime: f.getMimeType(),
        tam: f.getSize(),
        mod: Utilities.formatDate(f.getLastUpdated(), FUSO, 'yyyy-MM-dd')
      });
    }

    var pit = pasta.getFolders();
    while (pit.hasNext()) {
      var sub = pit.next();
      if (ignorar.indexOf(normalizar_(sub.getName())) >= 0) continue;
      varrer(sub, prefixo + sub.getName() + '/', nivel + 1);
    }
  })(raiz, '', 0);

  arquivos.sort(function (a, b) { return a.caminho < b.caminho ? -1 : 1; });

  var indice = {
    consultor: consultorId,
    pasta: raiz.getName(),
    pastaId: raiz.getId(),
    geradoEm: new Date().toISOString(),
    total: arquivos.length,
    arquivos: arquivos
  };

  gravarCacheGrande_(chave, indice, ACERVO.ttlIndiceSeg);
  try {
    gravarArquivoApp_(consultorId, 'indice.json', JSON.stringify(indice, null, 1),
                      'application/json');
  } catch (e) {
    console.log('Não deu para gravar _app/indice.json: ' + e.message);
  }
  return indice;
}

/** Reindexa e devolve um resumo (usado pelo botão "Atualizar acervo"). */
function reindexarAcervo(token, consultorId) {
  var ctx = exigirConsultor_(token, consultorId);
  var idx = acervoIndice_(ctx.consultor.id, true);
  return { total: idx.total, pasta: idx.pasta, geradoEm: idx.geradoEm };
}

/* -------------------- árvore e mapa para o prompt ------------------------ */

/** Árvore de pastas/arquivos em texto, truncada para não estourar o prompt. */
function acervoArvore_(indice) {
  var linhas = [];
  var pastaAtual = null;
  for (var i = 0; i < indice.arquivos.length; i++) {
    var a = indice.arquivos[i];
    var corte = a.caminho.lastIndexOf('/');
    var pasta = corte >= 0 ? a.caminho.slice(0, corte) : '(raiz)';
    if (pasta !== pastaAtual) {
      linhas.push('');
      linhas.push(pasta + '/');
      pastaAtual = pasta;
    }
    linhas.push('  ' + a.nome + '  [' + a.mod + ']');
  }
  var txt = linhas.join('\n').trim();
  if (txt.length > ACERVO.maxCharsArvore) {
    txt = txt.slice(0, ACERVO.maxCharsArvore) +
      '\n\n[...árvore truncada — use buscar_no_acervo para o resto]';
  }
  return txt;
}

/**
 * "Mapa do acervo": o 00-INDEX.md (ou equivalente) que o escritório mantém na
 * raiz da pasta. É o melhor resumo curado que existe, então entra sempre.
 */
function acervoMapa_(consultorId, indice) {
  var candidatos = indice.arquivos.filter(function (a) {
    return a.caminho.indexOf('/') < 0 && /^(00|01)[-_ ]?(index|indice|plano|mapa)/i.test(a.nome);
  });
  if (!candidatos.length) return '';
  var partes = [];
  for (var i = 0; i < Math.min(2, candidatos.length); i++) {
    var t = lerTextoDoArquivo_(candidatos[i], 25000);
    if (t) partes.push('### ' + candidatos[i].nome + '\n' + t);
  }
  return partes.join('\n\n');
}

/* ------------------------------- leitura --------------------------------- */

/** Lê o texto de um registro do índice, convertendo o formato quando precisa. */
function lerTextoDoArquivo_(reg, maxChars) {
  maxChars = maxChars || ACERVO.maxCharsLeitura;
  var cacheKey = 'txt_' + reg.id + '_' + (reg.mod || '');
  var doCache = CacheService.getScriptCache().get(cacheKey);
  if (doCache) return doCache.slice(0, maxChars);

  var texto = '';
  try {
    texto = extrairTexto_(reg);
  } catch (e) {
    return '[não foi possível ler "' + reg.caminho + '": ' + e.message + ']';
  }

  if (texto && texto.length < 95000) {
    try { CacheService.getScriptCache().put(cacheKey, texto, 3 * 3600); } catch (e) {}
  }
  return texto.slice(0, maxChars);
}

/** Extração por tipo de arquivo. */
function extrairTexto_(reg) {
  var mime = reg.mime || '';
  var file = DriveApp.getFileById(reg.id);

  if (mime === MimeType.GOOGLE_DOCS) {
    return DocumentApp.openById(reg.id).getBody().getText();
  }
  if (mime === MimeType.GOOGLE_SHEETS) {
    return planilhaParaTexto_(SpreadsheetApp.openById(reg.id));
  }
  if (ehTexto_(mime, reg.nome)) {
    if (reg.tam && reg.tam > ACERVO.maxBytesTextoDireto) {
      return file.getBlob().getDataAsString('UTF-8').slice(0, 200000) +
        '\n[...arquivo grande, truncado]';
    }
    return file.getBlob().getDataAsString('UTF-8');
  }
  if (mime === 'application/pdf' ||
      /officedocument\.wordprocessingml|msword/.test(mime)) {
    return textoViaConversao_(file, MimeType.GOOGLE_DOCS);
  }
  if (/officedocument\.spreadsheetml|ms-excel/.test(mime)) {
    return textoViaConversao_(file, MimeType.GOOGLE_SHEETS);
  }
  if (mime.indexOf('image/') === 0) {
    return '[imagem: ' + reg.nome + ' — para o consultor analisar a imagem, ' +
           'anexe-a na conversa]';
  }
  return '[formato não suportado para leitura: ' + mime + ']';
}

/**
 * Converte via Drive (PDF/DOCX → Documento, XLSX → Planilha), lê e apaga a
 * cópia temporária. O serviço avançado "Drive" precisa estar habilitado.
 */
function textoViaConversao_(file, mimeAlvo) {
  var copiaId = null;
  try {
    var copia = Drive.Files.copy(
      { name: '[tmp] ' + file.getName(), mimeType: mimeAlvo }, file.getId(),
      { supportsAllDrives: true });
    copiaId = copia.id;
    var texto = (mimeAlvo === MimeType.GOOGLE_SHEETS)
      ? planilhaParaTexto_(SpreadsheetApp.openById(copiaId))
      : DocumentApp.openById(copiaId).getBody().getText();
    return texto;
  } finally {
    if (copiaId) {
      try { Drive.Files.remove(copiaId, { supportsAllDrives: true }); }
      catch (e) { try { DriveApp.getFileById(copiaId).setTrashed(true); } catch (e2) {} }
    }
  }
}

/** Planilha → texto em TSV, aba por aba, com teto de linhas. */
function planilhaParaTexto_(ss, maxLinhasPorAba) {
  maxLinhasPorAba = maxLinhasPorAba || 400;
  var partes = [];
  ss.getSheets().forEach(function (sh) {
    var ultima = Math.min(sh.getLastRow(), maxLinhasPorAba);
    var colunas = sh.getLastColumn();
    if (!ultima || !colunas) return;
    var dados = sh.getRange(1, 1, ultima, colunas).getDisplayValues();
    partes.push('## Aba: ' + sh.getName() +
      ' (' + sh.getLastRow() + ' linhas x ' + colunas + ' colunas' +
      (sh.getLastRow() > ultima ? ', mostrando as ' + ultima + ' primeiras' : '') + ')');
    partes.push(dados.map(function (l) { return l.join('\t'); }).join('\n'));
  });
  return partes.join('\n\n');
}

/* -------------------------------- busca ---------------------------------- */

/**
 * Busca no acervo. Pontua caminho (peso 4) e conteúdo (peso 1) e devolve
 * trechos. Lê no máximo ACERVO.maxLeiturasPorBusca arquivos por chamada para
 * não estourar o tempo de execução.
 */
function acervoBuscar_(consultorId, termos, max) {
  max = max || 8;
  var indice = acervoIndice_(consultorId);
  var chaves = (termos || [])
    .map(function (t) { return normalizar_(t); })
    .filter(function (t) { return t.length >= 3; });
  if (!chaves.length) {
    return { termos: termos, resultados: [], aviso: 'Informe termos com 3+ caracteres.' };
  }

  var pontuados = indice.arquivos.map(function (a) {
    var alvo = normalizar_(a.caminho);
    var p = 0;
    chaves.forEach(function (k) { if (alvo.indexOf(k) >= 0) p += 4; });
    return { reg: a, pontos: p };
  });

  /* Primeiro os que casaram pelo nome/caminho; depois os textuais mais
     recentes — são os candidatos a ter o termo no corpo. */
  pontuados.sort(function (a, b) {
    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
    return (b.reg.mod || '') < (a.reg.mod || '') ? -1 : 1;
  });

  var resultados = [];
  var lidos = 0;
  for (var i = 0; i < pontuados.length; i++) {
    var item = pontuados[i];
    var reg = item.reg;
    var trecho = '';
    var achouNoTexto = 0;

    var legivel = ehTexto_(reg.mime, reg.nome) ||
                  reg.mime === MimeType.GOOGLE_DOCS ||
                  reg.mime === MimeType.GOOGLE_SHEETS;

    if (legivel && lidos < ACERVO.maxLeiturasPorBusca) {
      lidos++;
      var texto = lerTextoDoArquivo_(reg, 60000);
      var normal = normalizar_(texto);
      var primeiraPos = -1;
      chaves.forEach(function (k) {
        var pos = normal.indexOf(k);
        if (pos >= 0) {
          achouNoTexto++;
          if (primeiraPos < 0 || pos < primeiraPos) primeiraPos = pos;
        }
      });
      if (primeiraPos >= 0) {
        var ini = Math.max(0, primeiraPos - 220);
        trecho = (ini > 0 ? '…' : '') +
          texto.slice(ini, primeiraPos + 380).replace(/\s+/g, ' ') + '…';
      }
    }

    var pontos = item.pontos + achouNoTexto * 2;
    if (pontos > 0) {
      resultados.push({
        caminho: reg.caminho, tipo: reg.mime, atualizado: reg.mod,
        pontos: pontos, trecho: trecho
      });
    }
    if (resultados.length >= max * 3 && lidos >= ACERVO.maxLeiturasPorBusca) break;
  }

  resultados.sort(function (a, b) { return b.pontos - a.pontos; });
  return {
    termos: termos,
    arquivosNoAcervo: indice.total,
    arquivosLidos: lidos,
    resultados: resultados.slice(0, max)
  };
}

/** Lê um arquivo do acervo pelo caminho (como aparece na busca/árvore). */
function acervoLer_(consultorId, caminho, inicio) {
  var indice = acervoIndice_(consultorId);
  var alvo = normalizar_(caminho);
  var reg = null;

  for (var i = 0; i < indice.arquivos.length; i++) {
    if (normalizar_(indice.arquivos[i].caminho) === alvo) { reg = indice.arquivos[i]; break; }
  }
  if (!reg) {
    /* Tolerância: o operador (ou o consultor) pode passar só o nome do arquivo. */
    var parciais = indice.arquivos.filter(function (a) {
      return normalizar_(a.caminho).indexOf(alvo) >= 0 || normalizar_(a.nome) === alvo;
    });
    if (parciais.length === 1) reg = parciais[0];
    else if (parciais.length > 1) {
      return {
        erro: 'Mais de um arquivo casa com "' + caminho + '".',
        candidatos: parciais.slice(0, 12).map(function (a) { return a.caminho; })
      };
    }
  }
  if (!reg) {
    return { erro: 'Não existe "' + caminho + '" no acervo. Use buscar_no_acervo ' +
                   'ou listar_acervo para achar o caminho certo.' };
  }

  inicio = Math.max(0, parseInt(inicio || 0, 10));
  var completo = lerTextoDoArquivo_(reg, inicio + ACERVO.maxCharsLeitura + 1);
  var pedaco = completo.slice(inicio, inicio + ACERVO.maxCharsLeitura);
  return {
    caminho: reg.caminho,
    tipo: reg.mime,
    atualizado: reg.mod,
    inicio: inicio,
    fim: inicio + pedaco.length,
    truncado: completo.length > inicio + pedaco.length,
    conteudo: pedaco
  };
}

/* ------------------------------- gravação -------------------------------- */

/** Grava (ou substitui) um arquivo dentro de _app. */
function gravarArquivoApp_(consultorId, nome, conteudo, mime) {
  var pasta = pastaApp_(consultorId);
  var it = pasta.getFilesByName(nome);
  var blob = Utilities.newBlob(conteudo, mime || 'text/plain', nome);
  if (it.hasNext()) {
    var f = it.next();
    f.setContent(conteudo);
    return f;
  }
  return pasta.createFile(blob);
}

/**
 * Grava um markdown novo no acervo, numa subpasta (criando se preciso).
 * Devolve { caminho, id, url }. Nunca sobrescreve: se o nome existir, sufixa.
 */
function gravarMarkdownAcervo_(consultorId, subpastaNome, nomeArquivo, conteudo) {
  var raiz = resolverPastaConsultor(consultorId);
  var pasta = subpastaNome ? subpasta_(raiz, subpastaNome) : raiz;

  var base = nomeArquivo.replace(/\.md$/i, '');
  var nome = base + '.md';
  var n = 2;
  while (pasta.getFilesByName(nome).hasNext()) {
    nome = base + '-' + n + '.md';
    n++;
  }

  var file = pasta.createFile(Utilities.newBlob(conteudo, 'text/markdown', nome));
  CacheService.getScriptCache().remove('idx_' + consultorId);   // índice ficou velho
  return {
    caminho: (subpastaNome ? subpastaNome + '/' : '') + nome,
    id: file.getId(),
    url: file.getUrl()
  };
}

/* --------------------- cache maior que 100 KB ---------------------------- */

function gravarCacheGrande_(chave, objeto, ttl) {
  var txt = JSON.stringify(objeto);
  var pedacos = [];
  for (var i = 0; i < txt.length; i += 90000) pedacos.push(txt.slice(i, i + 90000));
  if (pedacos.length > 8) return;                 // grande demais: fica sem cache
  var c = CacheService.getScriptCache();
  var mapa = { n: pedacos.length };
  var itens = {};
  itens[chave] = JSON.stringify(mapa);
  pedacos.forEach(function (p, i) { itens[chave + '_' + i] = p; });
  try { c.putAll(itens, ttl); } catch (e) { console.log('cache: ' + e.message); }
}

function lerCacheGrande_(chave) {
  var c = CacheService.getScriptCache();
  var cab = c.get(chave);
  if (!cab) return null;
  try {
    var n = JSON.parse(cab).n;
    var chaves = [];
    for (var i = 0; i < n; i++) chaves.push(chave + '_' + i);
    var partes = c.getAll(chaves);
    var txt = '';
    for (var j = 0; j < n; j++) {
      var p = partes[chave + '_' + j];
      if (p == null) return null;                 // pedaço expirou: refaz tudo
      txt += p;
    }
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}
