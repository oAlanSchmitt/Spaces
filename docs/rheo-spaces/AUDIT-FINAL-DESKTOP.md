# Auditoria final e entrega Windows — 17/11/2026

Âmbito: evolução Spaces sobre `826393c`, para utilização local com projetos. Auditoria independente Ponytail dos caminhos de conhecimento/revogação/publicação, execução Codex, cancelamento, artefactos e estados da interface. REA reviu os contratos do pacote nativo e do lançador. Não foi uma leitura integral de todo o upstream.

## Correções confirmadas

1. **Exportação por hardlink.** Um ficheiro regular dentro do projeto podia ser um alias de conteúdo fora da pasta. Reprodução sintética antes da correção exportou o canário. A entrega agora abre o ficheiro, compara a identidade e exige uma única ligação no mesmo descritor que lê; fecha sempre e revalida o tamanho. Regressão confirma recusa, zero artefactos e original preservado. Esta defesa da exportação não comprova ausência de leitura de aliases preexistentes pelo próprio executor.
2. **Licenças no Windows.** A descoberta de pacotes npm aceitava apenas `/`; os caminhos Windows obtidos por `resolve` usavam `\`. Normalização e regressão Windows/POSIX corrigem a omissão de textos de licença no pacote.
3. **Raiz privada no bundle.** Os cálculos relativos a `import.meta.dir` mudavam de significado após empacotamento. Um único helper conserva o comportamento de fonte; o build local fixa a raiz original em tempo de compilação. Não existe override por variável de ambiente.

Não foi identificado outro defeito concreto no conhecimento compartilhado, revogação ou interface nesta revisão. Não foram acrescentadas dependências de aplicação, outro motor de agentes ou atualização automática.

## Executável

`scripts/rheo/build-spaces-desktop.ts` exige árvore Git limpa e reutiliza o empacotador nativo. A release recebe servidor, interface, migrations, assets, dependências WASM, Bun e licenças. Um `Spaces.exe` pequeno é compilado com o C# já instalado no Windows.

O executável fixa caminho e hash do manifesto e dos dois scripts carregados antes da verificação completa; o bootstrap verifica todos os ficheiros e rejeita extras, alterações, links e mudança de pasta. O servidor usa `APP_VERSION=spaces-<commit>` e liga o código-fonte ao commit do fork. Reutilização de processo exige executável, entrada e instante de criação corretos, além da versão na resposta de health. Não mata processos alheios ou por porta.

Dados e login permanecem em `.rheo/pilot-data`; o pacote não contém credenciais. A autenticação do navegador depende do perfil aberto. O pacote foi concebido para este PC; não é portátil. Depende do PowerShell 7 existente e do executável Codex validado. Se forem removidos ou alterados, deve falhar de forma explícita e requer nova validação/build. O fecho do navegador não termina o serviço; `Spaces.exe --stop` usa o supervisor e encerramento limpo existentes.

## Verificações antes do congelamento

- Ponytail: regressão hardlink RED/GREEN, 12 testes/74 asserções de trabalho Windows incluindo junction; tipos do servidor e Biome passaram.
- Raiz/pacote/provas: 34 testes/173 asserções comunicados pelo executor, mais tipos do servidor e Biome de sete ficheiros.
- Coordenador: 16 testes/76 asserções de manutenção/raiz/pacote, um teste de junction omitido dentro do sandbox. Seis testes/9 asserções específicos da release passaram. Grupos sobrepõem-se e não devem ser somados como cobertura única.
- Boundaries e migrations passaram. A validação final do artefacto gerado e do arranque será registada depois da construção.

Não foram repetidas chamadas de modelo pagas; as provas e o ensaio real de código/imagem de 16/11 são históricos. Não se verificou concorrência PostgreSQL, todos os idiomas ou aceitação de um projeto real nesta auditoria.
