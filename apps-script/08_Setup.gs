/**
 * ============================================================================
 *  CONSULTORES BM ADVOCACIA — Instalação e manutenção
 * ----------------------------------------------------------------------------
 *  Rode estas funções pelo editor do Apps Script (menu de seleção de função +
 *  "Executar"). Nada aqui é chamado pelo navegador.
 *
 *  ORDEM NA PRIMEIRA INSTALAÇÃO
 *    1. Configurações do projeto › Propriedades do script:
 *         ANTHROPIC_API_KEY = sk-ant-...        (obrigatório)
 *         CLAUDE_MODEL      = claude-opus-5     (opcional)
 *    2. conferirPastas()        — confirma qual pasta do Drive é de cada consultor
 *    3. criarUsuario('gabriel', 'uma-senha-forte', 'Gabriel Macedo')
 *    4. configurarTudo()        — cria os gatilhos de manutenção
 *    5. Implantar › Nova implantação › App da Web
 *         Executar como: Eu | Quem tem acesso: Qualquer pessoa
 *       (o login do próprio sistema é que protege o acesso)
 * ============================================================================
 */

/** Passo 2 — mostra o nome real de cada pasta e a qual consultor ela ficou. */
function conferirPastas() {
  var saida = [];
  PASTAS_INFORMADAS.forEach(function (id) {
    try {
      var f = DriveApp.getFolderById(id);
      saida.push('Pasta ' + id + ' → "' + f.getName() + '"');
    } catch (e) {
      saida.push('Pasta ' + id + ' → ERRO: ' + e.message);
    }
  });
  saida.push('');
  CONSULTORES.forEach(function (c) {
    try {
      var p = resolverPastaConsultor(c.id);
      saida.push(c.nome + '  →  "' + p.getName() + '"  (' + p.getId() + ')');
    } catch (e) {
      saida.push(c.nome + '  →  NÃO RESOLVIDO: ' + e.message);
    }
  });
  saida.push('');
  saida.push('Se alguma associação estiver errada, grave a propriedade ' +
             'PASTA_<id do consultor> (saude, bancario, comercial) com o ID certo.');
  var txt = saida.join('\n');
  console.log(txt);
  return txt;
}

/**
 * Passo 3 — cria (ou atualiza) um usuário.
 *
 *   criarUsuario('gabriel', 'senha-forte-aqui', 'Gabriel Macedo');
 *   criarUsuario('joao', 'outra-senha', 'João', ['saude']);   // só um consultor
 *
 * A senha NÃO fica gravada: só o hash com sal. Depois de rodar, apague a linha
 * da janela do editor para a senha não ficar no histórico do arquivo.
 */
function criarUsuario(login, senha, nome, consultores) {
  login = String(login || '').trim();
  senha = String(senha || '');
  if (!login) throw new Error('Informe o login.');
  if (senha.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');

  var lista = lerUsuarios_();
  var sal = sal_();
  var registro = {
    usuario: login,
    nome: nome || login,
    sal: sal,
    iteracoes: AUTH.iteracoes,
    hash: hashSenha_(senha, sal, AUTH.iteracoes),
    consultores: (consultores && consultores.length) ? consultores : ['*'],
    ativo: true,
    criadoEm: new Date().toISOString()
  };

  var existia = false;
  lista = lista.map(function (u) {
    if (normalizar_(u.usuario) === normalizar_(login)) {
      existia = true;
      registro.criadoEm = u.criadoEm || registro.criadoEm;
      return registro;
    }
    return u;
  });
  if (!existia) lista.push(registro);
  gravarUsuarios_(lista);

  var msg = (existia ? 'Senha/acessos atualizados para ' : 'Usuário criado: ') + login +
            ' — consultores: ' + registro.consultores.join(', ');
  console.log(msg);
  return msg;
}

/** Desativa um usuário sem apagar o histórico dele. */
function desativarUsuario(login) {
  var lista = lerUsuarios_();
  var achou = false;
  lista = lista.map(function (u) {
    if (normalizar_(u.usuario) === normalizar_(login)) { u.ativo = false; achou = true; }
    return u;
  });
  if (!achou) throw new Error('Usuário não encontrado: ' + login);
  gravarUsuarios_(lista);
  return 'Usuário desativado: ' + login;
}

/** Lista os usuários (sem hash nem sal). */
function listarUsuarios() {
  var txt = lerUsuarios_().map(function (u) {
    return (u.ativo ? '[ativo]  ' : '[inativo] ') + u.usuario + ' — ' + (u.nome || '') +
           ' — ' + (u.consultores || ['*']).join(', ') +
           (u.ultimoAcesso ? ' — último acesso ' + u.ultimoAcesso : '');
  }).join('\n') || '(nenhum usuário cadastrado)';
  console.log(txt);
  return txt;
}

/** Passo 4 — gatilhos de manutenção. Pode rodar de novo sem duplicar. */
function configurarTudo() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'manutencaoDiaria' || f === 'destravarPesquisas') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('manutencaoDiaria').timeBased().atHour(5).everyDays(1).create();
  ScriptApp.newTrigger('destravarPesquisas').timeBased().everyHours(1).create();

  var relatorio = ['Gatilhos criados: manutencaoDiaria (5h) e destravarPesquisas (1h).'];
  relatorio.push(conferirPastas());
  return relatorio.join('\n\n');
}

/** Reindexa os acervos, limpa fila velha e sessões vencidas. */
function manutencaoDiaria() {
  CONSULTORES.forEach(function (c) {
    try { acervoIndice_(c.id, true); }
    catch (e) { console.log('Reindex ' + c.id + ': ' + e.message); }
  });
  limparPesquisasAntigas();
  limparSessoesVencidas_();
}

/**
 * Teste de ponta a ponta sem navegador: confere chave, pasta, índice e faz uma
 * pergunta curta ao consultor indicado. Use depois de instalar.
 */
function testar(consultorId, pergunta) {
  consultorId = consultorId || 'saude';
  pergunta = pergunta || 'Em duas linhas: o que você tem de mais forte no seu acervo?';

  var consultor = acharConsultor(consultorId);
  if (!consultor) throw new Error('Consultor inválido: ' + consultorId);

  var indice = acervoIndice_(consultorId, true);
  console.log('Acervo: ' + indice.pasta + ' — ' + indice.total + ' arquivos');

  var r = conversarComFerramentas_({
    system: montarSystem_(consultor, indice),
    messages: [{ role: 'user', content: pergunta }],
    ferramentas: ferramentasDoConsultor_().filter(function (f) {
      return f.name !== 'pesquisar_tema';
    }),
    ctx: { consultorId: consultorId, conversaId: 'teste', lidos: [] },
    maxVoltas: 5
  });

  console.log('--- atividade ---');
  r.atividade.forEach(function (a) { console.log('- ' + a.resumo); });
  console.log('--- resposta ---');
  console.log(r.texto);
  console.log('--- uso --- entrada ' + r.uso.entrada + ' / saída ' + r.uso.saida +
              ' / cache lido ' + r.uso.cacheLido);
  return r.texto;
}
