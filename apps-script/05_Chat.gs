/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Conversa
 * ----------------------------------------------------------------------------
 *  Um turno de conversa:
 *    autentica → grava os anexos no acervo → monta o prompt (persona + regras +
 *    mapa do acervo) → roda o laço de ferramentas → grava a conversa no Drive.
 *
 *  As conversas ficam em <pasta do consultor>/_app/conversas/<id>.json, então o
 *  histórico também é acervo do escritório, não só estado de tela.
 * ============================================================================
 */

/* ----------------------------- o prompt ---------------------------------- */

/** Regras de conduta — iguais para os três consultores. */
function regrasDoConsultor_() {
  return [
    '## Como você trabalha',
    '',
    '1. **Sua fonte é o seu acervo.** Você responde com base nos arquivos da sua pasta,',
    '   nos anexos desta conversa e no que o operador disser aqui. Seu conhecimento geral',
    '   serve para entender a pergunta e escolher bons termos de busca — nunca como fonte',
    '   de uma afirmação.',
    '2. **Buscar antes de afirmar.** Antes de responder qualquer coisa de conteúdo, use',
    '   `buscar_no_acervo` (mais de uma vez, com sinônimos, números de súmula/tema, nomes',
    '   de operadora/banco) e leia os arquivos com `ler_do_acervo`. Nunca deduza o que há',
    '   dentro de um arquivo pelo nome dele.',
    '3. **Citar o que usou.** Toda resposta de conteúdo termina com "Fontes no acervo" e o',
    '   caminho dos arquivos que você efetivamente leu. Arquivo que você não abriu não',
    '   entra na lista.',
    '4. **Não sei é uma resposta legítima.** Se o acervo não cobre, diga em uma frase clara',
    '   ("não encontrei isso no meu acervo"), sem preencher o vazio com o que "costuma ser".',
    '   Aí escolha: se o tema é do seu âmbito e dá para pesquisar, chame `pesquisar_tema`;',
    '   se o pedido está ambíguo, pergunte antes.',
    '5. **Perguntar quando o comando não é claro.** Faltando o essencial (qual contrato,',
    '   qual fase do processo, qual tribunal, qual operadora ou banco, pessoa física ou',
    '   jurídica, o que já foi feito), pergunte em vez de supor. Uma ou duas perguntas',
    '   objetivas, não um questionário.',
    '6. **Nunca invente.** Número de súmula, tema repetitivo, número de processo, ementa,',
    '   artigo de lei, data, valor, percentual, nome de parte, resultado de julgamento:',
    '   ou está no acervo/anexo e você cita de onde veio, ou você diz que não tem.',
    '   Não existe "provavelmente é o Tema X". Errar um número aqui vira erro em petição.',
    '7. **Separe os planos.** Deixe explícito o que é (a) conteúdo do acervo, (b) sua',
    '   leitura/inferência a partir dele e (c) o que falta apurar.',
    '8. **Você assessora, não decide.** Recomende, mostre o risco e o contraponto, e diga',
    '   o que precisaria ser conferido antes de ir para a peça.',
    '9. **Fora do seu âmbito**, diga que não é sua área e indique o consultor certo do',
    '   painel (Revisional de Plano de Saúde, Direito Bancário ou Comercial).',
    '',
    '## Formato',
    '',
    '- Português do Brasil, markdown simples, direto ao ponto.',
    '- Comece com a resposta (2 a 4 linhas). Depois desenvolva no que for necessário.',
    '- Termine com **Fontes no acervo** (caminhos) e, quando fizer sentido,',
    '  **O que falta conferir**.',
    '- Sem elogio ao operador, sem repetir a pergunta, sem encher linguiça.'
  ].join('\n');
}

/** Blocos de system: o primeiro é estável (cacheável), o segundo é o acervo. */
function montarSystem_(consultor, indice) {
  var estavel = [
    'Você é o **' + consultor.nome + '** do escritório ' + APP.escritorio + '.',
    'Você atende os operadores do escritório (advogados e estagiários) dentro do painel',
    '"' + APP.nome + '". Hoje é ' + agoraTexto_() + '.',
    '',
    '## Seu âmbito',
    '',
    consultor.ambito,
    '',
    regrasDoConsultor_()
  ].join('\n');

  var mapa = acervoMapa_(consultor.id, indice);
  var acervo = [
    '## Seu acervo',
    '',
    'Pasta: **' + indice.pasta + '** — ' + indice.total + ' arquivos ' +
      '(índice de ' + Utilities.formatDate(new Date(indice.geradoEm), FUSO, 'dd/MM/yyyy HH:mm') + ').',
    'Os caminhos abaixo são os que você usa em `ler_do_acervo`.',
    '',
    '### Árvore',
    '',
    '```',
    acervoArvore_(indice),
    '```',
    mapa ? '\n### Índice curado pelo escritório\n\n' + mapa : ''
  ].join('\n');

  return [
    { type: 'text', text: estavel, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: acervo, cache_control: { type: 'ephemeral' } }
  ];
}

/* --------------------------- conversas no Drive -------------------------- */

function pastaConversas_(consultorId) {
  return subpasta_(pastaApp_(consultorId), 'conversas');
}

function novaConversaId_() {
  return Utilities.formatDate(new Date(), FUSO, 'yyyyMMdd-HHmmss') + '-' +
         Utilities.getUuid().slice(0, 6);
}

function lerConversa_(consultorId, conversaId) {
  var it = pastaConversas_(consultorId).getFilesByName(conversaId + '.json');
  if (!it.hasNext()) return null;
  try {
    return JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
  } catch (e) {
    return null;
  }
}

function gravarConversa_(consultorId, conversa) {
  conversa.atualizadaEm = new Date().toISOString();
  var pasta = pastaConversas_(consultorId);
  var nome = conversa.id + '.json';
  var txt = JSON.stringify(conversa, null, 1);
  var it = pasta.getFilesByName(nome);
  if (it.hasNext()) it.next().setContent(txt);
  else pasta.createFile(Utilities.newBlob(txt, 'application/json', nome));
  atualizarIndiceConversas_(consultorId, conversa);
  return conversa;
}

function atualizarIndiceConversas_(consultorId, conversa) {
  var nome = 'conversas-indice.json';
  var pasta = pastaApp_(consultorId);
  var lista = [];
  var it = pasta.getFilesByName(nome);
  var file = null;
  if (it.hasNext()) {
    file = it.next();
    try { lista = JSON.parse(file.getBlob().getDataAsString('UTF-8')) || []; } catch (e) {}
  }
  var registro = {
    id: conversa.id,
    titulo: conversa.titulo || '(sem título)',
    usuario: conversa.usuario,
    mensagens: (conversa.mensagens || []).length,
    atualizadaEm: conversa.atualizadaEm
  };
  var achou = false;
  lista = lista.map(function (x) {
    if (x && x.id === conversa.id) { achou = true; return registro; }
    return x;
  });
  if (!achou) lista.unshift(registro);
  lista.sort(function (a, b) {
    return String(b.atualizadaEm || '') < String(a.atualizadaEm || '') ? -1 : 1;
  });
  lista = lista.slice(0, 500);
  var txt = JSON.stringify(lista, null, 1);
  if (file) file.setContent(txt);
  else pasta.createFile(Utilities.newBlob(txt, 'application/json', nome));
}

/** Histórico da conversa no formato da API (texto puro, sem os blocos de tool). */
function historicoParaApi_(conversa) {
  var msgs = [];
  (conversa.mensagens || []).forEach(function (m) {
    if (m.papel === 'operador') {
      var t = m.texto || '';
      if (m.anexos && m.anexos.length) {
        t += '\n\n[Anexos desta mensagem, já gravados no acervo: ' +
             m.anexos.map(function (a) { return a.caminho; }).join('; ') + ']';
      }
      msgs.push({ role: 'user', content: t || '(sem texto)' });
    } else if (m.papel === 'consultor' && m.texto) {
      msgs.push({ role: 'assistant', content: m.texto });
    } else if (m.papel === 'sistema' && m.texto) {
      /* Nota de sistema (ex.: dossiê de pesquisa gravado) entra como contexto
         do operador, para o modelo poder usar sem confundir com fala dele. */
      msgs.push({ role: 'user', content: '[nota do sistema] ' + m.texto });
    }
  });
  return msgs;
}

function novaMensagem_(papel, texto, extra) {
  var m = {
    id: Utilities.getUuid().slice(0, 8),
    papel: papel,
    texto: texto || '',
    criadaEm: new Date().toISOString()
  };
  if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
  return m;
}

/* ---------------------------- chamadas do front -------------------------- */

/** Dados de abertura da tela: consultores liberados + últimas conversas. */
function carregarPainel(token, consultorId) {
  var s = exigirSessao_(token);
  var lista = CONSULTORES
    .filter(function (c) { return s.consultores.indexOf(c.id) >= 0; })
    .map(function (c) {
      return { id: c.id, nome: c.nome, curto: c.curto, icone: c.icone, cor: c.cor,
               ambito: c.ambito };
    });

  var alvo = consultorId && s.consultores.indexOf(consultorId) >= 0
    ? consultorId : (lista.length ? lista[0].id : null);

  var conversas = [];
  var acervo = null;
  if (alvo) {
    conversas = listarConversas(token, alvo);
    var idx = acervoIndice_(alvo);
    acervo = { pasta: idx.pasta, total: idx.total, geradoEm: idx.geradoEm,
               url: 'https://drive.google.com/drive/folders/' + idx.pastaId };
  }

  return {
    usuario: { login: s.usuario, nome: s.nome },
    consultores: lista,
    consultorAtivo: alvo,
    conversas: conversas,
    acervo: acervo,
    versao: APP.versao
  };
}

function listarConversas(token, consultorId) {
  var ctx = exigirConsultor_(token, consultorId);
  var pasta = pastaApp_(ctx.consultor.id);
  var it = pasta.getFilesByName('conversas-indice.json');
  if (!it.hasNext()) return [];
  try {
    var lista = JSON.parse(it.next().getBlob().getDataAsString('UTF-8')) || [];
    return lista.slice(0, 60);
  } catch (e) {
    return [];
  }
}

function abrirConversa(token, consultorId, conversaId) {
  var ctx = exigirConsultor_(token, consultorId);
  var c = lerConversa_(ctx.consultor.id, conversaId);
  if (!c) throw new Error('Conversa não encontrada.');
  return c;
}

/**
 * Manda uma mensagem ao consultor.
 * anexos = [{nome, mime, dadosBase64}]
 * Devolve a conversa atualizada (só as mensagens novas, para a tela anexar).
 */
function enviarMensagem(token, consultorId, conversaId, texto, anexos) {
  var inicio = Date.now();
  var ctx = exigirConsultor_(token, consultorId);
  var consultor = ctx.consultor;
  texto = String(texto == null ? '' : texto).trim();
  anexos = anexos || [];
  if (!texto && !anexos.length) throw new Error('Escreva a pergunta ou anexe um arquivo.');

  var conversa = conversaId ? lerConversa_(consultor.id, conversaId) : null;
  if (!conversa) {
    conversa = {
      id: novaConversaId_(),
      consultor: consultor.id,
      usuario: ctx.sessao.usuario,
      titulo: (texto || (anexos[0] && anexos[0].nome) || 'Nova conversa').slice(0, 70),
      criadaEm: new Date().toISOString(),
      mensagens: []
    };
  }

  /* 1. anexos → acervo + blocos do turno */
  var anexado = processarAnexos_(consultor.id, conversa.id, anexos, ctx.sessao.usuario);

  var msgOperador = novaMensagem_('operador', texto, {
    anexos: anexado.fichas,
    avisos: anexado.avisos
  });
  conversa.mensagens.push(msgOperador);

  /* 2. prompt */
  var indice = acervoIndice_(consultor.id);
  var system = montarSystem_(consultor, indice);

  var mensagens = historicoParaApi_({ mensagens: conversa.mensagens.slice(0, -1) });
  var conteudoAtual = anexado.blocos.slice();
  conteudoAtual.push({
    type: 'text',
    text: texto || '(sem texto — analise os arquivos anexados)'
  });
  if (anexado.fichas.length) {
    conteudoAtual.push({
      type: 'text',
      text: 'Estes anexos já foram gravados no seu acervo: ' +
            anexado.fichas.map(function (f) { return f.caminho; }).join('; ') +
            '. As fichas .md ao lado deles guardam o texto extraído.'
    });
  }
  mensagens.push({ role: 'user', content: conteudoAtual });

  /* 3. laço de ferramentas */
  var ctxFerramentas = {
    consultorId: consultor.id,
    conversaId: conversa.id,
    usuario: ctx.sessao.usuario,
    lidos: [],
    pesquisa: null
  };

  var r = conversarComFerramentas_({
    system: system,
    messages: mensagens,
    ferramentas: ferramentasDoConsultor_(),
    ctx: ctxFerramentas,
    deadline: inicio + APP.limiteMs
  });

  var textoResposta = r.texto;
  if (!textoResposta) {
    textoResposta = r.paradoPor === 'tempo'
      ? '_Não deu tempo de fechar a resposta dentro do limite de execução. ' +
        'Repita a pergunta em partes menores._'
      : '_O consultor não devolveu texto nesta rodada. Tente reformular._';
  }
  if (r.paradoPor === 'tempo') {
    textoResposta += '\n\n> ⏱ A rodada bateu no limite de tempo do Apps Script ' +
      '(6 minutos). Se a resposta ficou incompleta, peça a continuação.';
  }

  var msgConsultor = novaMensagem_('consultor', textoResposta, {
    atividade: r.atividade,
    arquivosLidos: ctxFerramentas.lidos,
    citacoes: r.citacoes,
    uso: r.uso,
    pesquisa: ctxFerramentas.pesquisa
  });
  conversa.mensagens.push(msgConsultor);
  gravarConversa_(consultor.id, conversa);

  return {
    conversaId: conversa.id,
    titulo: conversa.titulo,
    mensagens: [msgOperador, msgConsultor],
    avisos: anexado.avisos,
    pesquisa: ctxFerramentas.pesquisa,
    segundos: Math.round((Date.now() - inicio) / 1000)
  };
}

/**
 * Polling da tela: devolve as mensagens que apareceram depois de "ultimoId"
 * (usado enquanto uma pesquisa roda em segundo plano) e o estado da fila.
 */
function verificarConversa(token, consultorId, conversaId, ultimoId) {
  var ctx = exigirConsultor_(token, consultorId);
  var conversa = lerConversa_(ctx.consultor.id, conversaId);
  if (!conversa) return { novas: [], pesquisas: [] };

  var novas = [];
  var achou = !ultimoId;
  (conversa.mensagens || []).forEach(function (m) {
    if (achou) novas.push(m);
    if (m.id === ultimoId) achou = true;
  });

  return {
    novas: novas,
    pesquisas: statusPesquisas_(ctx.consultor.id, conversaId)
  };
}
