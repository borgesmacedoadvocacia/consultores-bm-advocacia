/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Pesquisa de tema novo (em segundo plano)
 * ----------------------------------------------------------------------------
 *  Quando o consultor não encontra o assunto no acervo, ele chama a ferramenta
 *  `pesquisar_tema`. Isso NÃO responde na hora: enfileira um job.
 *
 *  O job (gatilho de tempo, fora da requisição do navegador):
 *    1. pesquisa o tema com a busca na web da própria API (a única parte do
 *       sistema com acesso à internet),
 *    2. grava o resultado como dossiê markdown em 99-pesquisas-novas/,
 *    3. reindexa o acervo e faz o consultor responder a pergunta original já
 *       com base no dossiê — a resposta entra na conversa sozinha.
 *
 *  Assim o acervo cresce a cada tema novo, e nenhuma resposta nasce de
 *  "conhecimento solto": ela nasce de um arquivo que ficou na pasta.
 * ============================================================================
 */

var PESQ = {
  prefixo: 'PESQ_',
  maxUsosBusca: 12,
  deadlinePesquisaMs: 3.2 * 60 * 1000,
  deadlineRespostaMs: 5.2 * 60 * 1000,
  atrasoGatilhoMs: 25 * 1000
};

/* ------------------------------- a fila ---------------------------------- */

function enfileirarPesquisa_(o) {
  var id = 'p' + Utilities.formatDate(new Date(), FUSO, 'yyyyMMddHHmmss') +
           Utilities.getUuid().slice(0, 4);
  var job = {
    id: id,
    consultorId: o.consultorId,
    conversaId: o.conversaId,
    usuario: o.usuario,
    tema: o.tema,
    justificativa: o.justificativa || '',
    perguntas: o.perguntas || [],
    situacao: 'fila',
    criadoEm: new Date().toISOString()
  };
  props_().setProperty(PESQ.prefixo + id, JSON.stringify(job));
  agendarFila_();
  return job;
}

function agendarFila_() {
  var pendentes = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'processarFilaPesquisas';
  });
  /* Um gatilho pendente já dá conta da fila inteira. */
  if (pendentes.length >= 2) return;
  ScriptApp.newTrigger('processarFilaPesquisas')
    .timeBased()
    .after(PESQ.atrasoGatilhoMs)
    .create();
}

function lerJobs_(filtro) {
  var todas = props_().getProperties();
  var jobs = [];
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(PESQ.prefixo) !== 0) return;
    try {
      var j = JSON.parse(todas[k]);
      if (!filtro || filtro(j)) jobs.push(j);
    } catch (e) {}
  });
  jobs.sort(function (a, b) { return String(a.criadoEm) < String(b.criadoEm) ? -1 : 1; });
  return jobs;
}

function gravarJob_(job) {
  props_().setProperty(PESQ.prefixo + job.id, JSON.stringify(job));
}

/** Estado das pesquisas de uma conversa (a tela pergunta isso a cada 6s). */
function statusPesquisas_(consultorId, conversaId) {
  return lerJobs_(function (j) {
    return j.consultorId === consultorId && j.conversaId === conversaId;
  }).map(function (j) {
    return {
      id: j.id, tema: j.tema, situacao: j.situacao,
      criadoEm: j.criadoEm, terminadoEm: j.terminadoEm || null,
      dossie: j.dossie || null, erro: j.erro || null
    };
  });
}

/* --------------------------- o processamento ----------------------------- */

/** Gatilho. Pega um job da fila por execução e reagenda se sobrar trabalho. */
function processarFilaPesquisas() {
  limparGatilhosUsados_();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  var job = null;
  try {
    var fila = lerJobs_(function (j) { return j.situacao === 'fila'; });
    if (!fila.length) return;
    job = fila[0];
    job.situacao = 'rodando';
    job.iniciadoEm = new Date().toISOString();
    gravarJob_(job);
  } finally {
    lock.releaseLock();
  }

  if (!job) return;

  var inicio = Date.now();
  try {
    var dossie = pesquisarEGravar_(job, inicio + PESQ.deadlinePesquisaMs);
    job.dossie = dossie;
    responderComDossie_(job, dossie, inicio + PESQ.deadlineRespostaMs);
    job.situacao = 'pronto';
    job.terminadoEm = new Date().toISOString();
    gravarJob_(job);
  } catch (e) {
    job.situacao = 'erro';
    job.erro = e.message;
    job.terminadoEm = new Date().toISOString();
    gravarJob_(job);
    try {
      anotarNaConversa_(job, 'A pesquisa sobre "' + job.tema + '" falhou: ' + e.message);
    } catch (e2) {}
  }

  if (lerJobs_(function (j) { return j.situacao === 'fila'; }).length) agendarFila_();
}

function limparGatilhosUsados_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processarFilaPesquisas' &&
        t.getEventType() === ScriptApp.EventType.CLOCK) {
      try { ScriptApp.deleteTrigger(t); } catch (e) {}
    }
  });
}

/** Passo 1 e 2: pesquisa na web e grava o dossiê no acervo. */
function pesquisarEGravar_(job, deadline) {
  var consultor = acharConsultor(job.consultorId);
  var indice = acervoIndice_(job.consultorId);

  var system = [
    'Você é o pesquisador do ' + consultor.nome + ' do escritório ' + APP.escritorio + '.',
    'Sua tarefa: produzir um dossiê de referência sobre um tema que ainda NÃO existe no',
    'acervo, para virar arquivo permanente da pasta do consultor.',
    '',
    '## Âmbito do consultor',
    consultor.ambito,
    '',
    '## Regras do dossiê',
    '',
    '1. Pesquise na web com a ferramenta de busca. Prefira fonte primária: texto de lei,',
    '   resolução normativa da ANS, Banco Central, acórdão ou repositório oficial do',
    '   tribunal, site do CNJ. Doutrina e artigo de escritório valem como apoio, sinalizados',
    '   como tal.',
    '2. **Nada sem fonte.** Cada afirmação relevante traz a URL de onde veio. Não complete',
    '   lacuna com memória: se não achou, escreva "não localizado nesta pesquisa".',
    '3. Número de súmula, tema repetitivo, artigo, data de julgamento e percentual só entram',
    '   se você viu na fonte e citou a URL. Nunca aproxime.',
    '4. Registre divergência quando houver (ex.: STJ x tribunal estadual) em vez de escolher',
    '   um lado.',
    '5. Escreva em português do Brasil, markdown, para advogado do escritório ler e usar.',
    '',
    '## Formato exato da saída',
    '',
    'Devolva SOMENTE o markdown do dossiê, começando por "# " com o título do tema, com',
    'estas seções (pule a que não se aplicar):',
    '',
    '- **Em uma frase** — o que é e por que importa para o escritório.',
    '- **Base normativa** — lei, resolução, provimento (com artigo e URL).',
    '- **Como os tribunais decidem** — precedentes vinculantes, súmulas, posição do STJ e',
    '  dos tribunais estaduais, com URL e data.',
    '- **Aplicação na prática do escritório** — o que isso muda na tese, na petição, na',
    '  prova ou no cálculo.',
    '- **Pontos de atenção e riscos** — o que derruba a tese, prazos, ônus da prova.',
    '- **Lacunas desta pesquisa** — o que você não conseguiu confirmar.',
    '- **Fontes** — lista de URLs com data de acesso.'
  ].join('\n');

  var pedido = [
    'Tema a pesquisar: **' + job.tema + '**',
    '',
    'Por que estou pesquisando (o consultor buscou no acervo e não achou): ' +
      (job.justificativa || 'não informado'),
    '',
    job.perguntas.length
      ? 'Perguntas que o dossiê precisa responder:\n' +
        job.perguntas.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n')
      : '',
    '',
    'Para você saber o que o acervo já cobre (não repita o que já existe, e diga se o tema',
    'se conecta a algum destes eixos): pasta "' + indice.pasta + '" com ' + indice.total +
      ' arquivos.'
  ].join('\n');

  var r = conversarComFerramentas_({
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: pedido }],
    ferramentas: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: PESQ.maxUsosBusca }
    ],
    ctx: { consultorId: job.consultorId, conversaId: job.conversaId, lidos: [] },
    deadline: deadline,
    maxVoltas: 6,
    esforco: 'high'
  });

  if (!r.texto) {
    throw new Error('a pesquisa não devolveu conteúdo (parada por: ' + r.paradoPor + ')');
  }

  var cabecalho = [
    '---',
    'tema: ' + job.tema,
    'origem: pesquisa automática do ' + APP.nome,
    'solicitado_por: ' + (job.usuario || '-'),
    'data: ' + hojeIso_(),
    'conversa: ' + job.conversaId,
    'status: revisar — gerado por pesquisa na web, confira as fontes antes de usar em peça',
    '---',
    ''
  ].join('\n');

  return gravarMarkdownAcervo_(
    job.consultorId, APP.pastaPesquisas,
    hojeIso_() + '_' + slug_(job.tema),
    cabecalho + r.texto);
}

/** Passo 3: o consultor responde a pergunta original usando o dossiê novo. */
function responderComDossie_(job, dossie, deadline) {
  var consultor = acharConsultor(job.consultorId);
  var conversa = lerConversa_(job.consultorId, job.conversaId);
  if (!conversa) return;

  /* Registra o dossiê na conversa antes de responder — fica no histórico mesmo
     que a resposta falhe depois. */
  conversa.mensagens.push(novaMensagem_('sistema',
    'Pesquisa concluída sobre "' + job.tema + '". Dossiê gravado no acervo em `' +
    dossie.caminho + '`.', { dossie: dossie }));
  gravarConversa_(job.consultorId, conversa);

  var indice = acervoIndice_(job.consultorId, true);   // o dossiê precisa estar no índice
  var mensagens = historicoParaApi_(conversa);
  mensagens.push({
    role: 'user',
    content:
      '[nota do sistema] A pesquisa que você pediu terminou. O dossiê está no acervo em `' +
      dossie.caminho + '`. Leia-o com `ler_do_acervo` e agora responda a pergunta que o ' +
      'operador fez, deixando claro que a base é um dossiê novo, gerado por pesquisa na web ' +
      'e ainda não revisado por humano — e apontando o que precisa ser conferido antes de ' +
      'ir para uma peça.'
  });

  var ctxFerramentas = {
    consultorId: job.consultorId, conversaId: job.conversaId,
    usuario: job.usuario, lidos: []
  };
  var r = conversarComFerramentas_({
    system: montarSystem_(consultor, indice),
    messages: mensagens,
    ferramentas: ferramentasDoConsultor_().filter(function (f) {
      return f.name !== 'pesquisar_tema';        // nada de pesquisar em cascata
    }),
    ctx: ctxFerramentas,
    deadline: deadline,
    maxVoltas: 6
  });

  conversa = lerConversa_(job.consultorId, job.conversaId) || conversa;
  conversa.mensagens.push(novaMensagem_('consultor',
    r.texto || '_O dossiê foi gravado, mas não deu tempo de fechar a resposta. ' +
               'Pergunte de novo que agora eu respondo pelo dossiê._',
    { atividade: r.atividade, arquivosLidos: ctxFerramentas.lidos, uso: r.uso,
      origem: 'pesquisa', dossie: dossie }));
  gravarConversa_(job.consultorId, conversa);
}

function anotarNaConversa_(job, texto) {
  var conversa = lerConversa_(job.consultorId, job.conversaId);
  if (!conversa) return;
  conversa.mensagens.push(novaMensagem_('sistema', texto));
  gravarConversa_(job.consultorId, conversa);
}

/* --------------------------- manutenção da fila -------------------------- */

/** Apaga jobs terminados com mais de 7 dias. Roda junto com o gatilho diário. */
function limparPesquisasAntigas() {
  var limite = Date.now() - 7 * 24 * 3600 * 1000;
  var p = props_();
  lerJobs_().forEach(function (j) {
    if (j.situacao === 'fila' || j.situacao === 'rodando') return;
    var quando = Date.parse(j.terminadoEm || j.criadoEm || '') || 0;
    if (quando && quando < limite) p.deleteProperty(PESQ.prefixo + j.id);
  });
}

/**
 * Rede de segurança: um job que ficou "rodando" por mais de 15 minutos foi
 * interrompido (limite de execução, erro fora do try). Volta para a fila uma vez.
 */
function destravarPesquisas() {
  var limite = Date.now() - 15 * 60 * 1000;
  lerJobs_(function (j) { return j.situacao === 'rodando'; }).forEach(function (j) {
    var quando = Date.parse(j.iniciadoEm || '') || 0;
    if (quando && quando < limite) {
      if (j.retomada) {
        j.situacao = 'erro';
        j.erro = 'a execução foi interrompida duas vezes (tema grande demais?)';
      } else {
        j.retomada = true;
        j.situacao = 'fila';
      }
      gravarJob_(j);
    }
  });
  if (lerJobs_(function (j) { return j.situacao === 'fila'; }).length) agendarFila_();
}
