/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Usuário, senha e sessão
 * ----------------------------------------------------------------------------
 *  Usuários ficam na propriedade USUARIOS_JSON (Script Properties), com a senha
 *  guardada só como hash SHA-256 com sal e 10.000 iterações — a senha em texto
 *  não é gravada em lugar nenhum. Sessões ficam em propriedades SESSAO_<token>.
 *
 *  Para criar/alterar usuários, use as funções de 08_Setup.gs no editor.
 * ============================================================================
 */

var AUTH = {
  iteracoes: 10000,
  maxTentativas: 6,          // por usuário
  janelaBloqueioMin: 10
};

/* ------------------------------ hash de senha ---------------------------- */

function hashSenha_(senha, sal, iteracoes) {
  var atual = sal + ':' + senha;
  for (var i = 0; i < iteracoes; i++) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, atual, Utilities.Charset.UTF_8);
    atual = bytesParaHex_(bytes);
  }
  return atual;
}

function bytesParaHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

function sal_() {
  return bytesParaHex_(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, Utilities.getUuid() + Date.now()));
}

/** Comparação em tempo constante — evita vazar o hash por tempo de resposta. */
function iguais_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return d === 0;
}

/* ------------------------------- usuários -------------------------------- */

function lerUsuarios_() {
  var raw = props_().getProperty('USUARIOS_JSON');
  if (!raw) return [];
  try {
    var lista = JSON.parse(raw);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    throw new Error('USUARIOS_JSON está inválido (não é um JSON de lista). Corrija ou ' +
                    'recrie com criarUsuario().');
  }
}

function gravarUsuarios_(lista) {
  props_().setProperty('USUARIOS_JSON', JSON.stringify(lista));
}

function acharUsuario_(login) {
  var lista = lerUsuarios_();
  var alvo = normalizar_(login);
  for (var i = 0; i < lista.length; i++) {
    if (normalizar_(lista[i].usuario) === alvo) return lista[i];
  }
  return null;
}

/** Consultores que o usuário pode abrir. '*' libera todos. */
function consultoresDoUsuario_(u) {
  var permitidos = (u && u.consultores) ? u.consultores : ['*'];
  if (permitidos.indexOf('*') >= 0) {
    return CONSULTORES.map(function (c) { return c.id; });
  }
  return CONSULTORES
    .map(function (c) { return c.id; })
    .filter(function (id) { return permitidos.indexOf(id) >= 0; });
}

/* -------------------------------- sessões -------------------------------- */

function criarSessao_(u) {
  var token = Utilities.getUuid().replace(/-/g, '') + sal_().slice(0, 16);
  var sessao = {
    usuario: u.usuario,
    nome: u.nome || u.usuario,
    consultores: consultoresDoUsuario_(u),
    criadaEm: Date.now(),
    expiraEm: Date.now() + APP.horasSessao * 3600 * 1000
  };
  props_().setProperty('SESSAO_' + token, JSON.stringify(sessao));
  limparSessoesVencidas_();
  return { token: token, sessao: sessao };
}

/**
 * Valida o token e devolve a sessão. Toda função chamada pelo navegador passa
 * por aqui antes de tocar em acervo, API ou Drive.
 */
function exigirSessao_(token) {
  if (!token) throw new Error('SESSAO_INVALIDA');
  var raw = props_().getProperty('SESSAO_' + String(token));
  if (!raw) throw new Error('SESSAO_INVALIDA');
  var s;
  try { s = JSON.parse(raw); } catch (e) { throw new Error('SESSAO_INVALIDA'); }
  if (!s.expiraEm || s.expiraEm < Date.now()) {
    props_().deleteProperty('SESSAO_' + String(token));
    throw new Error('SESSAO_INVALIDA');
  }
  return s;
}

/** Sessão + verificação de que o usuário pode falar com aquele consultor. */
function exigirConsultor_(token, consultorId) {
  var s = exigirSessao_(token);
  var c = acharConsultor(consultorId);
  if (!c) throw new Error('Consultor desconhecido.');
  if (s.consultores.indexOf(c.id) < 0) {
    throw new Error('Seu usuário não tem acesso ao ' + c.nome + '.');
  }
  return { sessao: s, consultor: c };
}

function limparSessoesVencidas_() {
  var p = props_();
  var todas = p.getProperties();
  var agora = Date.now();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf('SESSAO_') !== 0) return;
    try {
      var s = JSON.parse(todas[k]);
      if (!s.expiraEm || s.expiraEm < agora) p.deleteProperty(k);
    } catch (e) {
      p.deleteProperty(k);
    }
  });
}

/* ------------------------- tentativas de login --------------------------- */

function chaveTentativas_(login) {
  return 'tent_' + Utilities.base64EncodeWebSafe(normalizar_(login));
}

function tentativasAtuais_(login) {
  var v = CacheService.getScriptCache().get(chaveTentativas_(login));
  return v ? parseInt(v, 10) : 0;
}

function registrarFalha_(login) {
  var n = tentativasAtuais_(login) + 1;
  CacheService.getScriptCache()
    .put(chaveTentativas_(login), String(n), AUTH.janelaBloqueioMin * 60);
  return n;
}

function limparFalhas_(login) {
  CacheService.getScriptCache().remove(chaveTentativas_(login));
}

/* --------------------------- chamada do front ---------------------------- */

/**
 * Login. Devolve { token, usuario, nome, consultores } ou lança erro com
 * mensagem pronta para a tela.
 */
function entrar(login, senha) {
  login = String(login || '').trim();
  senha = String(senha || '');
  if (!login || !senha) throw new Error('Informe usuário e senha.');

  if (tentativasAtuais_(login) >= AUTH.maxTentativas) {
    throw new Error('Muitas tentativas. Aguarde ' + AUTH.janelaBloqueioMin +
                    ' minutos e tente de novo.');
  }

  var lista = lerUsuarios_();
  if (!lista.length) {
    throw new Error('Nenhum usuário cadastrado ainda. No editor do Apps Script, rode ' +
                    'criarUsuario("login", "senha", "Nome") uma vez.');
  }

  var u = acharUsuario_(login);
  /* Usuário inexistente também paga o custo do hash: senão o tempo de resposta
     revelaria quais logins existem. */
  var salReferencia = (u && u.sal) ? u.sal : 'sal-inexistente';
  var iter = (u && u.iteracoes) ? u.iteracoes : AUTH.iteracoes;
  var calculado = hashSenha_(senha, salReferencia, iter);

  if (!u || !u.ativo || !iguais_(calculado, u.hash || '')) {
    var n = registrarFalha_(login);
    var restam = Math.max(0, AUTH.maxTentativas - n);
    throw new Error('Usuário ou senha incorretos.' +
      (restam <= 2 ? ' Restam ' + restam + ' tentativas.' : ''));
  }

  limparFalhas_(login);
  var nova = criarSessao_(u);

  u.ultimoAcesso = new Date().toISOString();
  gravarUsuarios_(lista.map(function (x) {
    return normalizar_(x.usuario) === normalizar_(u.usuario) ? u : x;
  }));

  return {
    token: nova.token,
    usuario: nova.sessao.usuario,
    nome: nova.sessao.nome,
    consultores: nova.sessao.consultores,
    expiraEm: nova.sessao.expiraEm
  };
}

/** Encerra a sessão. */
function sair(token) {
  if (token) props_().deleteProperty('SESSAO_' + String(token));
  return true;
}

/** Retoma a sessão guardada no navegador, se ainda válida. */
function retomarSessao(token) {
  try {
    var s = exigirSessao_(token);
    return {
      token: token, usuario: s.usuario, nome: s.nome,
      consultores: s.consultores, expiraEm: s.expiraEm
    };
  } catch (e) {
    return null;
  }
}

/** Troca de senha pelo próprio operador. */
function trocarSenha(token, senhaAtual, senhaNova) {
  var s = exigirSessao_(token);
  if (String(senhaNova || '').length < 8) {
    throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
  }
  var lista = lerUsuarios_();
  var u = acharUsuario_(s.usuario);
  if (!u) throw new Error('Usuário não encontrado.');
  if (!iguais_(hashSenha_(senhaAtual, u.sal, u.iteracoes || AUTH.iteracoes), u.hash)) {
    throw new Error('A senha atual não confere.');
  }
  u.sal = sal_();
  u.iteracoes = AUTH.iteracoes;
  u.hash = hashSenha_(senhaNova, u.sal, u.iteracoes);
  u.senhaTrocadaEm = new Date().toISOString();
  gravarUsuarios_(lista.map(function (x) {
    return normalizar_(x.usuario) === normalizar_(u.usuario) ? u : x;
  }));
  return true;
}
