/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Anexos do operador
 * ----------------------------------------------------------------------------
 *  Tudo que o operador anexa no chat:
 *    1. é gravado na pasta do consultor (98-anexos-operadores/AAAA-MM),
 *    2. ganha uma ficha .md ao lado, com metadados e o texto extraído — é isso
 *       que faz o anexo virar acervo pesquisável nas conversas seguintes,
 *    3. e vai para a mensagem daquele turno no formato que a API entende
 *       (PDF como documento com citações, imagem como imagem, resto como texto).
 * ============================================================================
 */

var IMAGENS_OK = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * anexos = [{ nome, mime, dadosBase64 }]
 * Devolve { blocos, fichas, avisos }
 */
function processarAnexos_(consultorId, conversaId, anexos, usuario) {
  var blocos = [];
  var fichas = [];
  var avisos = [];
  if (!anexos || !anexos.length) return { blocos: blocos, fichas: fichas, avisos: avisos };

  var totalBytes = 0;
  var pasta = pastaDoMes_(consultorId);

  for (var i = 0; i < anexos.length; i++) {
    var a = anexos[i] || {};
    var nome = String(a.nome || ('anexo-' + (i + 1)));
    var b64 = String(a.dadosBase64 || '');
    var mime = String(a.mime || '') || adivinharMime_(nome);
    var bytes = Math.round(b64.length * 0.75);

    if (!b64) { avisos.push(nome + ': arquivo vazio, ignorado.'); continue; }
    if (bytes > APP.maxMbPorArquivo * 1024 * 1024) {
      avisos.push(nome + ': passa de ' + APP.maxMbPorArquivo + ' MB, não foi enviado. ' +
                  'Coloque o arquivo direto na pasta do consultor e me diga o nome dele.');
      continue;
    }
    totalBytes += bytes;
    if (totalBytes > APP.maxMbPorMensagem * 1024 * 1024) {
      avisos.push(nome + ' e os seguintes ficaram de fora: a mensagem passou de ' +
                  APP.maxMbPorMensagem + ' MB. Mande em duas mensagens.');
      break;
    }

    /* 1. grava no acervo */
    var salvo;
    try {
      salvo = salvarAnexo_(pasta, nome, mime, b64);
    } catch (e) {
      avisos.push(nome + ': não deu para gravar na pasta (' + e.message + ').');
      continue;
    }

    /* 2. extrai texto (quando é possível) e cria a ficha */
    var textoExtraido = '';
    try {
      textoExtraido = extrairTexto_({
        id: salvo.id, nome: nome, mime: mime, tam: bytes, caminho: salvo.caminho
      });
    } catch (e) {
      textoExtraido = '';
    }
    try {
      var ficha = criarFicha_(pasta, nome, mime, bytes, salvo, textoExtraido,
                              conversaId, usuario);
      fichas.push({
        nome: nome, mime: mime, bytes: bytes,
        caminho: salvo.caminho, url: salvo.url, ficha: ficha.caminho,
        chars: textoExtraido ? textoExtraido.length : 0
      });
    } catch (e) {
      fichas.push({ nome: nome, mime: mime, bytes: bytes, caminho: salvo.caminho,
                    url: salvo.url, chars: textoExtraido ? textoExtraido.length : 0 });
      avisos.push(nome + ': anexo gravado, mas a ficha falhou (' + e.message + ').');
    }

    /* 3. monta o bloco de conteúdo do turno */
    if (mime === 'application/pdf') {
      blocos.push({
        type: 'document',
        title: nome,
        source: { type: 'base64', media_type: 'application/pdf', data: b64 },
        citations: { enabled: true }
      });
    } else if (IMAGENS_OK.indexOf(mime) >= 0) {
      blocos.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data: b64 }
      });
      blocos.push({ type: 'text', text: 'Imagem anexada: ' + nome });
    } else if (textoExtraido && textoExtraido.indexOf('[formato não suportado') !== 0) {
      var corte = textoExtraido.slice(0, APP.maxCharsTextoAnexo);
      blocos.push({
        type: 'text',
        text: '=== ARQUIVO ANEXADO: ' + nome + ' (' + mime + ') ===\n' +
              'Gravado no acervo em: ' + salvo.caminho + '\n' +
              '--- conteúdo ---\n' + corte +
              (textoExtraido.length > corte.length
                ? '\n[...truncado em ' + corte.length + ' de ' + textoExtraido.length +
                  ' caracteres — o arquivo completo está no acervo, use ler_do_acervo]'
                : '')
      });
    } else {
      avisos.push(nome + ': formato não lido automaticamente (' + mime + '). ' +
                  'O arquivo ficou gravado no acervo em ' + salvo.caminho + '.');
      blocos.push({
        type: 'text',
        text: 'Arquivo anexado e gravado no acervo, mas sem leitura automática: ' +
              salvo.caminho + ' (' + mime + ').'
      });
    }
  }

  /* O acervo mudou: o índice em cache já não vale. */
  if (fichas.length) CacheService.getScriptCache().remove('idx_' + consultorId);

  return { blocos: blocos, fichas: fichas, avisos: avisos };
}

function pastaDoMes_(consultorId) {
  var raiz = resolverPastaConsultor(consultorId);
  var anexos = subpasta_(raiz, APP.pastaAnexos);
  var mes = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM');
  var sub = subpasta_(anexos, mes);
  return { pasta: sub, relativo: APP.pastaAnexos + '/' + mes };
}

function salvarAnexo_(ctxPasta, nome, mime, b64) {
  var prefixo = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd_HHmm');
  var limpo = nome.replace(/[\\/:*?"<>|]/g, '-');
  var nomeFinal = prefixo + '_' + limpo;
  var n = 2;
  while (ctxPasta.pasta.getFilesByName(nomeFinal).hasNext()) {
    nomeFinal = prefixo + '_' + n + '_' + limpo;
    n++;
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, nomeFinal);
  var file = ctxPasta.pasta.createFile(blob);
  return {
    id: file.getId(),
    nome: nomeFinal,
    caminho: ctxPasta.relativo + '/' + nomeFinal,
    url: file.getUrl()
  };
}

function criarFicha_(ctxPasta, nomeOriginal, mime, bytes, salvo, texto, conversaId, usuario) {
  var nomeFicha = salvo.nome.replace(/\.[^.]+$/, '') + '__FICHA.md';
  var cab = [
    '# Anexo: ' + nomeOriginal,
    '',
    '- **Arquivo no acervo:** ' + salvo.caminho,
    '- **Link:** ' + salvo.url,
    '- **Tipo:** ' + mime,
    '- **Tamanho:** ' + (bytes / 1024).toFixed(1) + ' KB',
    '- **Anexado em:** ' + agoraTexto_(),
    '- **Anexado por:** ' + (usuario || '-'),
    '- **Conversa:** ' + (conversaId || '-'),
    '',
    '> Ficha gerada automaticamente pelo ' + APP.nome + '. O texto abaixo foi extraído ' +
    'do arquivo para permitir busca no acervo; em caso de divergência, vale o arquivo ' +
    'original.',
    ''
  ].join('\n');

  var corpo;
  if (!texto) {
    corpo = '## Texto extraído\n\n_Não foi possível extrair texto deste formato._\n';
  } else {
    corpo = '## Texto extraído\n\n```\n' + texto.slice(0, 400000) + '\n```\n';
  }

  var file = ctxPasta.pasta.createFile(
    Utilities.newBlob(cab + corpo, 'text/markdown', nomeFicha));
  return { caminho: ctxPasta.relativo + '/' + nomeFicha, id: file.getId() };
}

function adivinharMime_(nome) {
  var ext = (String(nome).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  var mapa = {
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
    json: 'application/json', xml: 'text/xml', html: 'text/html', htm: 'text/html',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword'
  };
  return mapa[ext] || 'application/octet-stream';
}
