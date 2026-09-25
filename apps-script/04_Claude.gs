/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Ponte com a API do Claude (Opus 5)
 * ----------------------------------------------------------------------------
 *  Um único ponto de saída para api.anthropic.com. A chave vem das Script
 *  Properties e nunca é devolvida ao navegador.
 *
 *  O consultor conversa com ferramentas (tool use):
 *    buscar_no_acervo   — procura termos nos arquivos da pasta dele
 *    ler_do_acervo      — lê um arquivo inteiro (em blocos)
 *    listar_acervo      — lista a árvore de pastas/arquivos
 *    pesquisar_tema     — só quando o acervo não cobre o assunto: enfileira uma
 *                         pesquisa detalhada, que roda em segundo plano e vira
 *                         um dossiê novo na pasta do consultor
 *
 *  No chat NÃO existe busca na internet. A internet só é usada no job de
 *  pesquisa (07_Pesquisa.gs), e o que vem dela é gravado no acervo antes de
 *  virar resposta. É isso que mantém a regra "responde pela base de dados".
 * ============================================================================
 */

var API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Chamada crua, com repetição em 429/5xx.
 *
 * Por padrão pedimos o fallback do servidor (se um classificador de política
 * recusar, a própria API repete o turno em outro modelo). Se a conta não tiver
 * esse beta liberado, a API devolve 400 — aí desligamos o recurso, gravamos a
 * decisão e seguimos sem ele, em vez de deixar o painel inutilizável.
 */
function chamarClaude_(corpo, betasExtra) {
  var semFallback = props_().getProperty('SEM_FALLBACK') === '1';

  var montar = function () {
    var corpoFinal = {};
    Object.keys(corpo).forEach(function (k) { corpoFinal[k] = corpo[k]; });
    var betas = (betasExtra || []).slice();
    if (semFallback) delete corpoFinal.fallbacks;
    else betas.unshift('server-side-fallback-2026-07-01');

    var cab = {
      'x-api-key': chaveApi_(),
      'anthropic-version': APP.versaoApi
    };
    if (betas.length) cab['anthropic-beta'] = betas.join(',');
    return {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: cab,
      payload: JSON.stringify(corpoFinal)
    };
  };

  var esperas = [0, 2000, 5000, 12000];
  var ultimoErro = '';
  for (var t = 0; t < esperas.length; t++) {
    if (esperas[t]) Utilities.sleep(esperas[t]);
    var r = UrlFetchApp.fetch(API_URL, montar());
    var codigo = r.getResponseCode();
    var texto = r.getContentText();

    if (codigo === 200) {
      try {
        return JSON.parse(texto);
      } catch (e) {
        ultimoErro = 'resposta da API não é JSON válido';
        continue;
      }
    }

    if (codigo === 429 || codigo >= 500) {
      ultimoErro = 'HTTP ' + codigo + ' — ' + resumoErroApi_(texto);
      continue;                                   // vale repetir
    }

    /* Beta de fallback não liberado para esta conta: desliga e tenta de novo. */
    var msg = resumoErroApi_(texto);
    if (codigo === 400 && !semFallback && /fallback|beta/i.test(msg)) {
      semFallback = true;
      props_().setProperty('SEM_FALLBACK', '1');
      console.log('Fallback do servidor indisponível nesta conta — seguindo sem ele.');
      t--;                                        // esta tentativa não conta
      continue;
    }

    /* 4xx que não é 429: erro nosso (pedido malformado, chave inválida, ...). */
    throw new Error('A API do Claude recusou o pedido (HTTP ' + codigo + '): ' + msg);
  }
  throw new Error('A API do Claude não respondeu depois de 4 tentativas. ' + ultimoErro);
}

function resumoErroApi_(texto) {
  try {
    var j = JSON.parse(texto);
    if (j && j.error && j.error.message) return j.error.message;
  } catch (e) {}
  return String(texto || '').slice(0, 300);
}

/* ---------------------------- ferramentas -------------------------------- */

function ferramentasDoConsultor_() {
  return [
    {
      name: 'buscar_no_acervo',
      description:
        'Procura termos nos arquivos da sua pasta (nome, caminho e conteúdo) e devolve ' +
        'os arquivos mais prováveis com um trecho de cada um. Use SEMPRE antes de ' +
        'afirmar qualquer coisa, e use várias vezes com termos diferentes (sinônimos, ' +
        'número de súmula, nome de operadora/banco, número de tema repetitivo) antes de ' +
        'concluir que o acervo não tem o assunto. O trecho é só uma pista: para citar, ' +
        'leia o arquivo com ler_do_acervo.',
      input_schema: {
        type: 'object',
        properties: {
          termos: {
            type: 'array',
            items: { type: 'string' },
            description: 'De 1 a 6 termos ou expressões, com 3+ caracteres cada.'
          },
          max: { type: 'integer', description: 'Quantos arquivos devolver (1 a 15). Padrão 8.' }
        },
        required: ['termos']
      }
    },
    {
      name: 'ler_do_acervo',
      description:
        'Lê um arquivo do acervo pelo caminho exato (como aparece na busca ou na ' +
        'árvore). Devolve até 40 mil caracteres por chamada; se vier truncado, chame de ' +
        'novo com "inicio" no valor de "fim" para continuar. Leia antes de citar: nunca ' +
        'deduza o conteúdo de um arquivo pelo nome dele.',
      input_schema: {
        type: 'object',
        properties: {
          caminho: { type: 'string', description: 'Ex.: 03-teses/reajuste-faixa-etaria.md' },
          inicio: { type: 'integer', description: 'Posição inicial em caracteres. Padrão 0.' }
        },
        required: ['caminho']
      }
    },
    {
      name: 'listar_acervo',
      description:
        'Lista a árvore de pastas e arquivos do acervo. Útil para se situar quando a ' +
        'busca não achou nada ou quando o operador pergunta o que você tem sobre um eixo.',
      input_schema: {
        type: 'object',
        properties: {
          pasta: {
            type: 'string',
            description: 'Filtro opcional: só os caminhos que contenham este texto.'
          }
        },
        required: []
      }
    },
    {
      name: 'pesquisar_tema',
      description:
        'Enfileira uma pesquisa detalhada sobre um tema que NÃO está no seu acervo. ' +
        'A pesquisa roda em segundo plano (alguns minutos), consulta fontes na internet, ' +
        'vira um dossiê em markdown gravado na sua pasta e depois você responde com base ' +
        'nele. Use apenas depois de ter buscado no acervo com termos variados e não ter ' +
        'achado. Não use para pedido ambíguo — aí pergunte ao operador primeiro. ' +
        'Depois de chamar esta ferramenta, encerre o turno explicando ao operador, em uma ' +
        'frase, o que você não tinha e o que vai pesquisar.',
      input_schema: {
        type: 'object',
        properties: {
          tema: { type: 'string', description: 'Título do tema, curto e específico.' },
          justificativa: {
            type: 'string',
            description: 'O que você buscou no acervo e por que concluiu que não há base.'
          },
          perguntas: {
            type: 'array',
            items: { type: 'string' },
            description: 'De 3 a 8 perguntas que o dossiê precisa responder.'
          }
        },
        required: ['tema', 'justificativa', 'perguntas']
      }
    }
  ];
}

/** Executa uma ferramenta e devolve o texto do tool_result. */
function executarFerramenta_(nome, entrada, ctx) {
  entrada = entrada || {};

  if (nome === 'buscar_no_acervo') {
    var termos = entrada.termos;
    if (typeof termos === 'string') termos = [termos];
    if (!Array.isArray(termos) || !termos.length) {
      return { erro: 'Passe "termos" como lista de textos.' };
    }
    var max = Math.min(15, Math.max(1, parseInt(entrada.max || 8, 10)));
    return acervoBuscar_(ctx.consultorId, termos.slice(0, 6), max);
  }

  if (nome === 'ler_do_acervo') {
    if (!entrada.caminho) return { erro: 'Passe "caminho".' };
    var r = acervoLer_(ctx.consultorId, entrada.caminho, entrada.inicio);
    if (!r.erro && r.caminho && ctx.lidos.indexOf(r.caminho) < 0) ctx.lidos.push(r.caminho);
    return r;
  }

  if (nome === 'listar_acervo') {
    var idx = acervoIndice_(ctx.consultorId);
    var filtro = normalizar_(entrada.pasta || '');
    var lista = idx.arquivos
      .filter(function (a) { return !filtro || normalizar_(a.caminho).indexOf(filtro) >= 0; })
      .map(function (a) { return a.caminho + '  [' + a.mod + ']'; });
    return {
      pasta: idx.pasta,
      total: idx.total,
      mostrando: Math.min(lista.length, 400),
      arquivos: lista.slice(0, 400)
    };
  }

  if (nome === 'pesquisar_tema') {
    if (!entrada.tema) return { erro: 'Passe "tema".' };
    var perguntas = Array.isArray(entrada.perguntas) ? entrada.perguntas : [];
    var job = enfileirarPesquisa_({
      consultorId: ctx.consultorId,
      conversaId: ctx.conversaId,
      usuario: ctx.usuario,
      tema: entrada.tema,
      justificativa: entrada.justificativa || '',
      perguntas: perguntas
    });
    ctx.pesquisa = {
      id: job.id, tema: entrada.tema, perguntas: perguntas,
      justificativa: entrada.justificativa || ''
    };
    return {
      situacao: 'pesquisa enfileirada',
      id: job.id,
      tema: entrada.tema,
      aviso: 'A pesquisa roda em segundo plano. Encerre o turno avisando o operador; ' +
             'quando o dossiê estiver na pasta, você responderá automaticamente.'
    };
  }

  return { erro: 'Ferramenta desconhecida: ' + nome };
}

/* ------------------------------ o laço ----------------------------------- */

/**
 * Conversa com o modelo até ele terminar (ou até o prazo/limite de voltas).
 *
 * opcoes = {
 *   system: [blocos], messages: [...], ferramentas: [...], ctx: {...},
 *   maxVoltas, deadline (ms epoch), maxTokens, esforco, betas
 * }
 * Devolve { texto, citacoes, mensagens, atividade, paradoPor, uso }
 */
function conversarComFerramentas_(opcoes) {
  var mensagens = opcoes.messages.slice();
  var atividade = [];
  var citacoes = [];
  var uso = { entrada: 0, saida: 0, cacheLido: 0 };
  var paradoPor = 'fim';
  var textoFinal = '';
  var voltas = 0;
  var maxVoltas = opcoes.maxVoltas || APP.maxVoltasFerramenta;
  var deadline = opcoes.deadline || (Date.now() + APP.limiteMs);

  while (true) {
    if (Date.now() > deadline) { paradoPor = 'tempo'; break; }
    if (voltas > maxVoltas) { paradoPor = 'limite-de-voltas'; break; }
    voltas++;

    var corpo = {
      model: modelo_(),
      max_tokens: opcoes.maxTokens || APP.maxTokens,
      system: opcoes.system,
      messages: mensagens,
      thinking: { type: 'adaptive' },
      output_config: { effort: opcoes.esforco || APP.esforco },
      fallbacks: 'default'
    };
    if (opcoes.ferramentas && opcoes.ferramentas.length) corpo.tools = opcoes.ferramentas;

    var resp = chamarClaude_(corpo, opcoes.betas);

    if (resp.usage) {
      uso.entrada += resp.usage.input_tokens || 0;
      uso.saida += resp.usage.output_tokens || 0;
      uso.cacheLido += resp.usage.cache_read_input_tokens || 0;
    }

    var blocos = resp.content || [];
    mensagens.push({ role: 'assistant', content: blocos });

    /* Texto e citações desta volta. */
    blocos.forEach(function (b) {
      if (b.type === 'text') {
        textoFinal = (textoFinal ? textoFinal + '\n\n' : '') + b.text;
        (b.citations || []).forEach(function (cit) {
          citacoes.push({
            titulo: cit.document_title || '',
            trecho: cit.cited_text || '',
            pagina: cit.start_page_number || null
          });
        });
      }
    });

    /* Recusa por política: não é erro de rede, é resposta. */
    if (resp.stop_reason === 'refusal') {
      paradoPor = 'recusa';
      if (!textoFinal) {
        textoFinal = 'Não consigo responder a este pedido. Se ele for sobre um caso do ' +
                     'escritório, reformule com o contexto processual.';
      }
      break;
    }

    /* Ferramenta de servidor pediu pausa: repetir sem nova mensagem do usuário. */
    if (resp.stop_reason === 'pause_turn') { continue; }

    if (resp.stop_reason !== 'tool_use') {
      if (resp.stop_reason === 'max_tokens') paradoPor = 'max-tokens';
      break;
    }

    /* Executa TODAS as ferramentas do turno e devolve os resultados juntos. */
    var resultados = [];
    for (var i = 0; i < blocos.length; i++) {
      var b = blocos[i];
      if (b.type !== 'tool_use') continue;
      var saida, erro = false;
      try {
        saida = executarFerramenta_(b.name, b.input, opcoes.ctx);
      } catch (e) {
        saida = { erro: e.message };
        erro = true;
      }
      atividade.push({
        ferramenta: b.name,
        entrada: b.input,
        resumo: resumoAtividade_(b.name, b.input, saida)
      });
      resultados.push({
        type: 'tool_result',
        tool_use_id: b.id,
        is_error: erro || !!(saida && saida.erro),
        content: JSON.stringify(saida).slice(0, 180000)
      });
    }

    if (!resultados.length) break;
    mensagens.push({ role: 'user', content: resultados });

    /* Pesquisa enfileirada: o turno acaba aqui, o resto é em segundo plano. */
    if (opcoes.ctx && opcoes.ctx.pesquisa && opcoes.pararNaPesquisa !== false) {
      /* deixa o modelo escrever a frase de aviso e encerra */
      opcoes.ferramentas = (opcoes.ferramentas || []).filter(function (f) {
        return f.name !== 'pesquisar_tema';
      });
    }
  }

  return {
    texto: textoFinal.trim(),
    citacoes: citacoes,
    mensagens: mensagens,
    atividade: atividade,
    paradoPor: paradoPor,
    uso: uso
  };
}

/** Frase curta do que a ferramenta fez — vai para a linha de atividade na tela. */
function resumoAtividade_(nome, entrada, saida) {
  entrada = entrada || {};
  if (nome === 'buscar_no_acervo') {
    var n = (saida && saida.resultados) ? saida.resultados.length : 0;
    return 'buscou "' + [].concat(entrada.termos || []).join('", "') + '" — ' +
           n + (n === 1 ? ' arquivo' : ' arquivos');
  }
  if (nome === 'ler_do_acervo') {
    if (saida && saida.erro) return 'tentou ler ' + entrada.caminho + ' — não achou';
    return 'leu ' + (saida && saida.caminho ? saida.caminho : entrada.caminho);
  }
  if (nome === 'listar_acervo') {
    return 'listou o acervo' + (entrada.pasta ? ' (' + entrada.pasta + ')' : '') +
           ((saida && saida.total) ? ' — ' + saida.total + ' arquivos' : '');
  }
  if (nome === 'pesquisar_tema') return 'abriu pesquisa: ' + entrada.tema;
  if (nome === 'web_search') return 'pesquisou na internet';
  return nome;
}
