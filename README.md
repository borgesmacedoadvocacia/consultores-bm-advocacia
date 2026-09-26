# Consultores BM Advocacia

Painel de consultores internos do escritório **Borges Macedo Advocacia**. O operador
escolhe no menu lateral com quem quer falar, conversa por chat, anexa arquivos — e o
consultor responde **com base no acervo da pasta dele no Google Drive**, citando os
arquivos que usou.

| Consultor | Acervo |
|---|---|
| Revisional de Plano de Saúde | pasta do Drive do consultor de saúde |
| Direito Bancário | pasta do Drive do consultor bancário |
| Comercial | pasta do Drive do consultor comercial |

> **No ar:** https://script.google.com/a/borgesmacedoadvocacia.com.br/macros/s/AKfycbzP1Sf3K8rbFT7IvrwI8ibpW_KhPySy23za9QcyPsMAWNsCgMTfhJub894ENiXs10urtw/exec
>
> A URL precisa levar o `/a/borgesmacedoadvocacia.com.br/`. Sem o domínio, o Chrome com várias
> contas logadas reescreve para `/macros/u/N/s/...` e devolve "Não foi possível abrir o arquivo".

Roda inteiro dentro do **Google Apps Script** (é lá que fica a chave da API do Claude) e
conversa com o **Claude Opus 5** pela API da Anthropic.

---

## As quatro regras que definem o sistema

1. **Responde pelo acervo.** No chat, o consultor não tem internet. As únicas fontes são
   os arquivos da pasta dele, os anexos da conversa e o que o operador disser ali. Ele lê
   os arquivos antes de afirmar e termina a resposta com **Fontes no acervo** — o caminho
   de cada arquivo que abriu.
2. **Não sabe é resposta.** Se a busca no acervo não achar, ele diz que não achou. Não
   existe "provavelmente é o Tema X": número de súmula, tema repetitivo, artigo, data,
   valor ou percentual só entram se estiverem no acervo, com a fonte.
3. **Pergunta quando o comando não está claro.** Faltando o essencial (qual contrato, qual
   fase, qual tribunal, qual operadora ou banco, PF ou PJ), ele pergunta em vez de supor.
4. **Tema novo vira acervo.** Quando o assunto não está na pasta, o consultor abre uma
   **pesquisa**: ela roda em segundo plano, aí sim com busca na web, vira um dossiê
   markdown gravado em `99-pesquisas-novas/` e só depois ele responde — dizendo que a base
   é um dossiê novo, ainda não revisado por humano. O acervo cresce a cada tema.

E **todo anexo entra no acervo**: o arquivo original vai para
`98-anexos-operadores/AAAA-MM/`, com uma ficha `.md` ao lado contendo metadados e o texto
extraído. Da próxima conversa em diante, aquilo já é material pesquisável — anexar deixa o
consultor mais completo de verdade, não só naquele chat.

---

## Como funciona

```
Navegador (HTML servido pelo Apps Script)
        │  google.script.run + token de sessão
        ▼
Apps Script  ─── acervo ───►  pasta do consultor no Google Drive
        │                       (md, pdf, xlsx, docx, Docs, Sheets, imagens)
        │  API (chave só aqui)
        ▼
api.anthropic.com  ·  claude-opus-5
        ferramentas: buscar_no_acervo · ler_do_acervo · listar_acervo · pesquisar_tema
        (web_search só no job de pesquisa, nunca no chat)
```

**Formatos que o consultor lê nos anexos:** PDF (vai direto para o modelo, com citação de
página), imagens PNG/JPG/GIF/WebP (análise visual), TXT/MD/CSV/TSV/JSON/XML/HTML, XLSX/XLS
e DOCX/DOC (convertidos via Drive), além de Documentos e Planilhas Google que já estejam na
pasta. Teto de 8 MB por arquivo e 16 MB por mensagem — arquivo maior que isso vai direto para a
pasta do Drive e é citado pelo nome na pergunta.

**Conversas ficam no Drive**, em `_app/conversas/` dentro da pasta de cada consultor — o
histórico é acervo do escritório, não estado de tela.

---

## Instalação

Passo a passo completo em **[docs/INSTALACAO.md](docs/INSTALACAO.md)**. Resumo:

1. Criar um projeto em [script.google.com](https://script.google.com) e colar os arquivos
   de `apps-script/`.
2. Habilitar o serviço avançado **Drive (v3)**.
3. Em *Configurações do projeto › Propriedades do script*, criar
   `ANTHROPIC_API_KEY` com a chave da Anthropic (`sk-ant-...`).
4. Rodar `conferirPastas()`, depois `criarUsuario('login', 'senha', 'Nome')` para cada
   operador, depois `configurarTudo()`.
5. Implantar como **App da Web** (*Executar como: Eu* · *Acesso: Qualquer pessoa*) — quem
   protege o painel é o login do próprio sistema.
6. Conferir com `testar('saude')`.

---

## Mapa dos arquivos

```
apps-script/
  appsscript.json     manifesto (escopos, serviço Drive, web app)
  00_Config.gs        consultores, personas, limites, resolução das pastas do Drive
  01_WebApp.gs        doGet (serve a interface) e diagnóstico
  02_Auth.gs          usuário, senha (hash com sal), sessão, bloqueio por tentativa
  03_Acervo.gs        índice da pasta, busca, leitura e gravação de arquivos
  04_Claude.gs        ponte com a API, definição das ferramentas, laço de tool use
  05_Chat.gs          um turno de conversa: prompt, histórico, gravação no Drive
  06_Anexos.gs        anexo → arquivo no acervo + ficha .md + bloco para o modelo
  07_Pesquisa.gs      fila de pesquisa em segundo plano e gravação do dossiê
  08_Setup.gs         instalação, usuários, gatilhos, teste de ponta a ponta
  Index.html          estrutura da tela (login + painel)
  Estilo.html         CSS — layout dos dashboards BM, tema claro e escuro
  Script.html         front-end (chat, anexos, polling, markdown)
docs/
  INSTALACAO.md       instalação, operação e manutenção
```

## Segurança

- A chave da API **nunca** sai do Apps Script: fica nas Script Properties e não aparece no
  navegador, nas conversas nem neste repositório.
- Senhas são guardadas só como hash SHA-256 com sal e 10.000 iterações. Seis tentativas
  erradas bloqueiam o usuário por 10 minutos.
- Sessão de 12 horas, guardada como token; toda função do servidor valida o token antes de
  tocar em acervo, Drive ou API.
- O acesso do web app é "qualquer pessoa" porque o login do sistema é que barra a entrada —
  quem abre a URL sem usuário só vê a tela de login. Cada usuário pode ser limitado a
  consultores específicos (`criarUsuario('joao','...','João',['saude'])`).

## Custo

Cada turno de conversa consome tokens da API da Anthropic (Opus 5). O que pesa é a leitura
de arquivos do acervo; o prompt fixo é cacheado a cada chamada para reduzir isso. Uma
pesquisa de tema novo é mais caro que um turno normal, porque inclui busca na web e a
redação do dossiê. O consumo de cada resposta aparece gravado na conversa (`uso`).

## Tema claro e escuro

O botão ◐ no pé da lateral alterna, e a escolha fica no navegador. Os tokens de cor são os
mesmos dos dashboards BM (dourado `#C4A028` sobre azul-noite `#060e1f`), com uma variante
clara equivalente.
