/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Configuração
 * ----------------------------------------------------------------------------
 *  Cada consultor é uma pasta do Drive (o acervo dele) + uma persona.
 *  Nada aqui guarda segredo: a chave da API e os usuários ficam nas
 *  Script Properties (Configurações do projeto › Propriedades do script).
 * ============================================================================
 */

var APP = {
  nome: 'Consultores BM Advocacia',
  escritorio: 'Borges Macedo Advocacia',
  versao: '1.0.0',

  /* Modelo e parâmetros da chamada à API do Claude. O modelo pode ser trocado
     pela propriedade CLAUDE_MODEL sem mexer no código. */
  modelo: 'claude-opus-5',
  maxTokens: 16000,
  esforco: 'high',            // output_config.effort — low | medium | high | xhigh | max
  versaoApi: '2023-06-01',

  /* Limites de execução. O Apps Script derruba a chamada em 6 minutos; paramos
     antes disso para devolver algo ao operador em vez de um erro seco. */
  limiteMs: 4.7 * 60 * 1000,
  maxVoltasFerramenta: 10,

  /* Anexos (por mensagem). O teto da requisição da API é 32 MB. */
  maxMbPorArquivo: 12,
  maxMbPorMensagem: 24,
  maxCharsTextoAnexo: 180000,

  /* Sessão do operador. */
  horasSessao: 12,

  /* Nomes das subpastas que o app cria dentro da pasta de cada consultor. */
  pastaAnexos: '98-anexos-operadores',
  pastaPesquisas: '99-pesquisas-novas',
  pastaApp: '_app'
};

/* ---------------------------------------------------------------------------
 *  Pastas informadas pelo escritório (links passados na criação do sistema).
 *  A associação pasta → consultor é resolvida pelo NOME da pasta no Drive
 *  (ver resolverPastaConsultor), então a ordem desta lista não importa.
 *  Para fixar manualmente, grave a propriedade PASTA_<id do consultor>
 *  (ex.: PASTA_saude) com o ID da pasta.
 * ------------------------------------------------------------------------- */
var PASTAS_INFORMADAS = [
  '1cgxt40nAn7BUZz9iRmD63BNt7FiRC_f3',
  '1wYe4k7ivTECUsZiuXwldKAA6MSvcq-XE',
  '1_XdsQ1olncYdJyvpyM2i0kQNFvd736ux'
];

/* ---------------------------------------------------------------------------
 *  Os consultores.
 *  - chavesPasta: usadas para casar o nome da pasta do Drive com o consultor.
 *  - ambito: o que ele cobre. Entra no prompt para ele saber recusar o que não
 *    é dele — não é fonte de fato, o fato vem sempre do acervo.
 * ------------------------------------------------------------------------- */
var CONSULTORES = [
  {
    id: 'saude',
    nome: 'Consultor em Revisional de Plano de Saúde',
    curto: 'Revisional de Plano de Saúde',
    icone: 'RS',
    cor: '#42a5f5',
    chavesPasta: ['plano de saude', 'revisional de plano', 'saude'],
    ambito:
      'Ações revisionais de plano de saúde: reajuste por faixa etária, reajuste por ' +
      'sinistralidade em contratos coletivos, migração e adaptação de contratos, ' +
      'reajuste de plano individual fora do teto da ANS, negativa de cobertura e ' +
      'rescisão unilateral. Operadoras, autogestões e administradoras de benefícios. ' +
      'Normas da ANS, CDC, precedentes do STJ e dos tribunais estaduais, cálculo do ' +
      'indébito e prática processual dessas ações.'
  },
  {
    id: 'bancario',
    nome: 'Consultor em Direito Bancário',
    curto: 'Direito Bancário',
    icone: 'DB',
    cor: '#C4A028',
    chavesPasta: ['bancario', 'direito bancario', 'banco'],
    ambito:
      'Revisão de contratos bancários: financiamento imobiliário (SFH/SFI), ' +
      'financiamento de veículo com alienação fiduciária, cédulas e contratos de ' +
      'crédito de pessoa física e jurídica. Juros, capitalização, tarifas, seguros ' +
      'vendidos em conjunto com o financiamento, sistemas de amortização, ' +
      'superendividamento e busca e apreensão. Precedentes vinculantes, súmulas, ' +
      'posição dos tribunais e prática processual dessas ações.'
  },
  {
    id: 'comercial',
    nome: 'Consultor Comercial',
    curto: 'Comercial',
    icone: 'CO',
    cor: '#43a047',
    chavesPasta: ['comercial', 'vendas', 'sdr'],
    ambito:
      'Operação comercial do escritório: prospecção e qualificação, abordagem e ' +
      'diagnóstico, apresentação de proposta e honorários, tratamento de objeções, ' +
      'follow-up, fechamento, scripts e playbooks, métricas e metas do time, ' +
      'CRM e rotina de funil. Também o recorte de marketing jurídico permitido pelo ' +
      'Código de Ética e Disciplina da OAB e pelo Provimento 205/2021.'
  }
];

/** Devolve o consultor pelo id, ou null. */
function acharConsultor(id) {
  for (var i = 0; i < CONSULTORES.length; i++) {
    if (CONSULTORES[i].id === id) return CONSULTORES[i];
  }
  return null;
}

/** Atalho para as Script Properties. */
function props_() {
  return PropertiesService.getScriptProperties();
}

/** Chave da API do Claude. Fica só nas Script Properties. */
function chaveApi_() {
  var k = props_().getProperty('ANTHROPIC_API_KEY');
  if (!k) {
    throw new Error(
      'A chave da API do Claude não está configurada. Em Configurações do projeto › ' +
      'Propriedades do script, crie a propriedade ANTHROPIC_API_KEY com a chave ' +
      '(sk-ant-...). Ela nunca vai para o GitHub nem para o navegador.'
    );
  }
  return k;
}

/** Modelo em uso (permite trocar por propriedade sem editar o código). */
function modelo_() {
  return props_().getProperty('CLAUDE_MODEL') || APP.modelo;
}

/** Normaliza texto para comparação: minúsculas, sem acento, sem pontuação dupla. */
function normalizar_(t) {
  return String(t == null ? '' : t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Descobre qual pasta do Drive é o acervo de um consultor.
 *
 * 1. Se existir a propriedade PASTA_<id>, ela manda.
 * 2. Senão, lê o NOME de cada pasta informada e casa com chavesPasta.
 * 3. O resultado é gravado na propriedade para as próximas execuções.
 *
 * Erra alto e explicando: um consultor apontado para a pasta errada responderia
 * com o acervo de outro assunto, o que é pior do que não responder.
 */
function resolverPastaConsultor(consultorId) {
  var c = acharConsultor(consultorId);
  if (!c) throw new Error('Consultor desconhecido: ' + consultorId);

  var p = props_();
  var fixado = p.getProperty('PASTA_' + c.id);
  if (fixado) return DriveApp.getFolderById(fixado);

  var candidatos = [];
  var erros = [];
  for (var i = 0; i < PASTAS_INFORMADAS.length; i++) {
    var id = PASTAS_INFORMADAS[i];
    var nome;
    try {
      nome = DriveApp.getFolderById(id).getName();
    } catch (e) {
      erros.push(id + ' (' + e.message + ')');
      continue;
    }
    var n = normalizar_(nome);
    for (var k = 0; k < c.chavesPasta.length; k++) {
      if (n.indexOf(c.chavesPasta[k]) >= 0) {
        candidatos.push({ id: id, nome: nome, peso: c.chavesPasta.length - k });
        break;
      }
    }
  }

  if (!candidatos.length) {
    throw new Error(
      'Não encontrei a pasta do acervo de "' + c.nome + '" entre as pastas informadas' +
      (erros.length ? ' (falha ao abrir: ' + erros.join('; ') + ')' : '') +
      '. Grave a propriedade PASTA_' + c.id + ' com o ID da pasta correta.'
    );
  }

  /* Mais de uma pasta casou: escolhe a de chave mais específica e registra o
     empate no log, para o setup poder conferir. */
  candidatos.sort(function (a, b) { return b.peso - a.peso; });
  if (candidatos.length > 1) {
    console.log('Mais de uma pasta casou com ' + c.id + ': ' +
      candidatos.map(function (x) { return x.nome; }).join(' | ') +
      ' — usando "' + candidatos[0].nome + '".');
  }

  p.setProperty('PASTA_' + c.id, candidatos[0].id);
  return DriveApp.getFolderById(candidatos[0].id);
}

/** Subpasta com um nome dado, criando se não existir. */
function subpasta_(pai, nome) {
  var it = pai.getFoldersByName(nome);
  if (it.hasNext()) return it.next();
  return pai.createFolder(nome);
}

/** Pasta interna de trabalho do app (conversas, índice, filas). */
function pastaApp_(consultorId) {
  return subpasta_(resolverPastaConsultor(consultorId), APP.pastaApp);
}

/** Data/hora no formato usado nos nomes de arquivo e nos textos. */
var FUSO = 'America/Bahia';

function agoraTexto_() {
  return Utilities.formatDate(new Date(), FUSO, 'dd/MM/yyyy HH:mm');
}

function hojeIso_() {
  return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
}

/** Slug seguro para nome de arquivo. */
function slug_(t) {
  return normalizar_(t)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'sem-titulo';
}
