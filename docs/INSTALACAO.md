# Instalação e operação

Tempo estimado: 15 minutos. Tudo é feito com a conta Google que é dona das pastas dos
consultores (as pastas estão em *Meu Drive*, então precisa ser a conta que as enxerga).

---

## 1. Criar o projeto no Apps Script

1. Abra [script.google.com](https://script.google.com) › **Novo projeto**.
2. Renomeie o projeto para **Consultores BM Advocacia**.
3. Crie os arquivos abaixo e cole o conteúdo de cada um da pasta `apps-script/` deste
   repositório. Os `.gs` entram como *Script*; os `.html` como *HTML*
   (⊕ ao lado de "Arquivos" › HTML).

   | No editor | Arquivo do repositório |
   |---|---|
   | `00_Config.gs` … `08_Setup.gs` | mesmos nomes |
   | `Index.html`, `Estilo.html`, `Script.html` | mesmos nomes |

   Apague o `Código.gs` vazio que o editor cria sozinho.

4. Manifesto: em **Configurações do projeto**, marque *Mostrar o arquivo de manifesto
   "appsscript.json"*. Volte ao editor, abra `appsscript.json` e cole o conteúdo do
   repositório.

> Alternativa por linha de comando, se você usa o `clasp`:
> ```bash
> cd apps-script
> clasp login
> clasp create --type webapp --title "Consultores BM Advocacia"
> clasp push
> ```

## 2. Habilitar o serviço avançado do Drive

No editor, em **Serviços** (⊕ na barra esquerda) › adicione **Drive API**, versão **v3**,
com o identificador `Drive`. É o que permite ler PDF, DOCX e XLSX (o Drive converte o
arquivo, o script lê o texto e apaga a cópia temporária).

## 3. Guardar a chave da API

**Configurações do projeto › Propriedades do script › Adicionar propriedade:**

| Propriedade | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | sua chave da Anthropic (`sk-ant-...`) — **obrigatório** |
| `CLAUDE_MODEL` | `claude-opus-5` (opcional; só para trocar de modelo sem editar código) |

A chave fica só aqui. Ela não aparece no navegador, nem nas conversas, nem no GitHub.
Pegue uma chave em [console.anthropic.com](https://console.anthropic.com) › *API keys*.

## 4. Conferir as pastas dos consultores

No editor, selecione a função **`conferirPastas`** e clique em *Executar*. Na primeira
execução o Google pede autorização — aceite (é a sua própria conta acessando as suas
pastas).

O log mostra o nome real de cada pasta e a qual consultor ela ficou:

```
Pasta 1cgx... → "Consultor - Revisional de Plano de Saúde"
...
Consultor em Revisional de Plano de Saúde  →  "Consultor - Revisional de Plano de Saúde"
Consultor em Direito Bancário              →  "Consultor - Direito Bancário"
Consultor Comercial                        →  "Consultor Comercial"
```

A associação é feita pelo **nome** da pasta. Se alguma linha vier errada ou "NÃO
RESOLVIDO", grave a propriedade correspondente com o ID certo da pasta:

| Propriedade | Consultor |
|---|---|
| `PASTA_saude` | Revisional de Plano de Saúde |
| `PASTA_bancario` | Direito Bancário |
| `PASTA_comercial` | Comercial |

## 5. Criar os usuários

Ainda no editor, abra `08_Setup.gs`, escreva a chamada no final do arquivo, rode a função
`criarUsuario` — e **apague a linha depois**, para a senha não ficar guardada no código:

```js
criarUsuario('gabriel', 'uma-senha-forte-aqui', 'Gabriel Macedo');
criarUsuario('maria',   'outra-senha-forte',    'Maria', ['saude']);  // só um consultor
```

Só o hash da senha é gravado (SHA-256 com sal, 10.000 iterações). Outras funções úteis:
`listarUsuarios()`, `desativarUsuario('login')`, e para redefinir uma senha basta chamar
`criarUsuario` de novo com o mesmo login.

O próprio operador pode trocar a senha depois; a função do servidor é `trocarSenha`.

## 6. Criar os gatilhos

Rode **`configurarTudo()`**. Ele cria:

- `manutencaoDiaria` às 5h — reindexa os três acervos, limpa fila e sessões vencidas;
- `destravarPesquisas` a cada hora — devolve à fila uma pesquisa que tenha sido
  interrompida pelo limite de 6 minutos do Apps Script.

## 7. Implantar

**Implantar › Nova implantação › Tipo: App da Web**

| Campo | Valor |
|---|---|
| Executar como | **Eu** (a conta dona das pastas) |
| Quem tem acesso | **Qualquer pessoa** |

"Qualquer pessoa" é proposital: quem abre a URL sem usuário e senha só vê a tela de login.
Se você escolher "qualquer pessoa da organização", o Google passa a pedir login Google
antes, o que também funciona — mas aí o painel só abre para contas do domínio.

Copie a URL `.../exec` e distribua ao time.

## 8. Testar

1. No editor, rode `testar('saude')` — ele indexa o acervo, faz uma pergunta curta e mostra
   no log as ferramentas usadas, a resposta e o consumo de tokens.
2. Abra a URL do web app, entre com um usuário, mande uma pergunta que você sabe que está
   no acervo e confira se a lista **Fontes no acervo** aponta arquivos reais.
3. Anexe um PDF e peça uma avaliação. Depois confira que ele apareceu em
   `98-anexos-operadores/AAAA-MM/` junto com a ficha `__FICHA.md`.
4. Pergunte algo claramente fora do acervo. O esperado é: ele diz que não tem, abre a
   pesquisa, e alguns minutos depois a resposta aparece sozinha na conversa, com o dossiê
   gravado em `99-pesquisas-novas/`.

---

## Operação no dia a dia

| Ação | Onde |
|---|---|
| Trocar de consultor | menu lateral esquerdo |
| Nova conversa | botão **+ Nova conversa** |
| Reler a pasta depois de adicionar arquivos à mão | botão **Atualizar acervo** |
| Ver se falta configuração | botão **Diagnóstico** |
| Tema claro/escuro | botão ◐ no pé da lateral |
| Anexar | clipe 📎, ou arraste o arquivo para a janela |

Enter envia, Shift+Enter quebra linha.

## Manutenção

- **Adicionar um consultor novo:** acrescente um item em `CONSULTORES` (`00_Config.gs`) com
  `id`, `nome`, `curto`, `icone`, `cor`, `chavesPasta` e `ambito`, e o ID da pasta em
  `PASTAS_INFORMADAS` (ou grave `PASTA_<id>`). Nada mais precisa mudar.
- **Ajustar o comportamento** (o que ele exige antes de afirmar, como cita fonte, quando
  pergunta): `regrasDoConsultor_()` em `05_Chat.gs`.
- **Gastar menos por resposta:** baixe `APP.esforco` para `'medium'` em `00_Config.gs`.
- **Revisar os dossiês de pesquisa:** eles nascem com `status: revisar` no cabeçalho. Depois
  de conferir as fontes, edite o arquivo, troque o status e, se for o caso, mova para o eixo
  definitivo da pasta (`03-teses/`, `02-precedentes-vinculantes/` etc.).

## Problemas conhecidos

| Sintoma | Causa e saída |
|---|---|
| "A chave da API do Claude não está configurada" | falta `ANTHROPIC_API_KEY` nas propriedades do script |
| "Não encontrei a pasta do acervo de ..." | nome da pasta mudou — grave `PASTA_<id>` com o ID certo |
| "Drive is not defined" | o serviço avançado Drive (v3) não foi habilitado (passo 2) |
| Resposta cortada com aviso de limite de tempo | o Apps Script derruba a execução em 6 min; peça em partes menores |
| Anexo grande recusado | acima de 8 MB: coloque o arquivo direto na pasta do Drive e cite o nome dele |
| Pesquisa parada em "rodando" | `destravarPesquisas` devolve à fila na hora seguinte |
| Nenhum usuário cadastrado | rode `criarUsuario(...)` (passo 5) |

## Atualizar o sistema depois

Ao trocar um arquivo, cole a nova versão no editor e crie uma **nova implantação** (ou
*Gerenciar implantações › editar › versão: nova*), senão a URL continua servindo a versão
antiga.
