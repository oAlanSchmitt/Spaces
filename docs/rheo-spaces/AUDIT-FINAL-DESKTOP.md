# Auditoria final e entrega Windows — 17/11/2026

Âmbito: evolução Spaces sobre `826393c`, para utilização local com projetos. Auditoria independente Ponytail dos caminhos de conhecimento/revogação/publicação, execução Codex, cancelamento, artefactos e estados da interface. REA reviu os contratos do pacote nativo e do lançador. Não foi uma leitura integral de todo o upstream.

## Correções confirmadas

1. **Exportação por hardlink.** Um ficheiro regular dentro do projeto podia ser um alias de conteúdo fora da pasta. Reprodução sintética antes da correção exportou o canário. A entrega agora abre o ficheiro, compara a identidade e exige uma única ligação no mesmo descritor que lê; fecha sempre e revalida o tamanho. Regressão confirma recusa, zero artefactos e original preservado. Esta defesa da exportação não comprova ausência de leitura de aliases preexistentes pelo próprio executor.
2. **Licenças no Windows.** A descoberta de pacotes npm aceitava apenas `/`; os caminhos Windows obtidos por `resolve` usavam `\`. Normalização e regressão Windows/POSIX corrigem a omissão de textos de licença no pacote.
3. **Raiz privada no bundle.** Os cálculos relativos a `import.meta.dir` mudavam de significado após empacotamento. Um único helper conserva o comportamento de fonte; o build local fixa a raiz original em tempo de compilação. Não existe override por variável de ambiente.
4. **Verificação lenta.** A leitura repetida dos ancestrais de cada ficheiro tornava o arranque demorado. A verificação agora confere os ancestrais da raiz uma vez e verifica cada entrada, hash e lista de ficheiros numa única passagem. Na mesma fixture sintética com 1.068 ficheiros, passou de 98,475 s para 0,561 s; a profundidade da fixture não representa o tempo real da aplicação. Dez testes/16 asserções passaram, incluindo junctions internas e ancestrais reais.

Não foi identificado outro defeito concreto no conhecimento compartilhado, revogação ou interface nesta revisão. Não foram acrescentadas dependências de aplicação, outro motor de agentes ou atualização automática.

## Executável

`scripts/rheo/build-spaces-desktop.ts` exige árvore Git limpa e reutiliza o empacotador nativo. A release recebe servidor, interface, migrations, assets, dependências WASM, Bun e licenças. Um `Spaces.exe` pequeno é compilado com o C# já instalado no Windows.

O executável fixa caminho e hash do manifesto e dos dois scripts carregados antes da verificação completa; o bootstrap verifica todos os ficheiros e rejeita extras, alterações, links e mudança de pasta. O servidor usa `APP_VERSION=spaces-<commit>` e liga o código-fonte ao commit do fork. Reutilização de processo exige executável, entrada e instante de criação corretos, além da versão na resposta de health. Não mata processos alheios ou por porta.

Dados e login permanecem em `.rheo/pilot-data`; o pacote não contém credenciais. A autenticação do navegador depende do perfil aberto. O pacote foi concebido para este PC; não é portátil. Depende do PowerShell 7 existente e do executável Codex validado. Se forem removidos ou alterados, deve falhar de forma explícita e requer nova validação/build. O fecho do navegador não termina o serviço; `Spaces.exe --stop` usa o supervisor e encerramento limpo existentes.

## Verificações antes do congelamento

- Ponytail: regressão hardlink RED/GREEN, 12 testes/74 asserções de trabalho Windows incluindo junction; tipos do servidor e Biome passaram.
- Raiz/pacote/provas: 34 testes/173 asserções comunicados pelo executor, mais tipos do servidor e Biome de sete ficheiros.
- Coordenador: 16 testes/76 asserções de manutenção/raiz/pacote, um teste de junction omitido dentro do sandbox. Seis testes/9 asserções específicos da release passaram. Grupos sobrepõem-se e não devem ser somados como cobertura única.
- Boundaries e migrations passaram. Tipos do servidor/web e Biome dos dez ficheiros TypeScript afetados passaram. O verificador final da release passou 10 testes/16 asserções, incluindo junctions reais na árvore e nos ancestrais.

## Entrega observada

- Executável: `C:/Users/alan-/Desktop/Spaces.exe`, 14.336 bytes. Código congelado: `0b2e2f4b2661ef82452be45d5fe5c1363a595ee7`, publicado no fork; versão `spaces-0b2e2f4b2661`.
- SHA-256 do executável: `49875f90eb3f1e98bf0659a6c88b3348d9f3f8bbabdf30a665caa67f117fdb0d`. Pacote local: 1.068 ficheiros, aproximadamente 206 MB, licenças de 90 pacotes incorporados. Nenhum dado/login foi incluído.
- REA confirmou PE32/.NET AnyCPU, subsistema Windows GUI e os três hashes de bootstrap. A inspeção estática e o arranque são evidências independentes.
- Abertura normal pelo executável: saída 0 e navegador padrão aberto em `localhost:4410/login`, em 21,09 s. Verificação isolada: saída 0 em 1,42 s. Segunda abertura: mesmo PID **27868** e mesmo launchId, em 5,75 s, com health/DB prontos na versão exata.
- A sessão autenticada no navegador interno confirmou catálogo, estado geral Codex pronto, pasta original do projeto e **Pronto para trabalhar**, após recarregar a release final. O navegador padrão pede a sessão local porque tem cookies distintos; não foram transferidas credenciais.
- Backup frio anterior: 2.063 ficheiros, ACL privada, `.rheo/backups/20261117T115250495Z-b04429e0d5ed4380898ec61771571b60`. O recibo antigo de um processo já encerrado foi arquivado após confirmar ausência do processo e exclusão da base. A primeira release de teste foi encerrada pelo supervisor, com saída limpa, antes da entrega final.
- A configuração de trabalho continua com o mesmo digest `8bbdd3ed436c56562c185e5b93bfebb5b33c7608710ac5be22cfa7aee5c98154`; o leitor de produção aceitou a prova existente, sem chamadas de modelo. Recibos privados: `.rheo/probes/desktop-final-20261117.json`, `rea-exe-final-summary.json` e `release-performance-20261117.json`.

Para utilização, dê dois cliques no executável. A aplicação mantém o Design System existente; esta auditoria não redesenhou a interface. O guia de uso descreve a dependência da pasta original e o encerramento por `--stop`.

## Conhecimento reutilizável

Para consulta pela Devstore, os mecanismos úteis são: recibos de fontes com revisão para revogação, ligação explícita entre projeto e pasta, exportação pelo mesmo descritor validado e manifesto de release separado dos dados privados. Reutilizar os padrões e as suas regressões é suficiente; não há benefício concreto em importar novamente o próprio checkout ou instalar outra ferramenta. Ponytail, REA, Harness e Segurança já cobrem esta necessidade; não é necessário criar um especialista. Esta auditoria não incorporou conteúdo nem alterou soluções internas da Devstore.

Não foram repetidas chamadas de modelo pagas; as provas e o ensaio real de código/imagem de 16/11 são históricos. Não se verificou concorrência PostgreSQL, todos os idiomas ou aceitação de um projeto real nesta auditoria.
