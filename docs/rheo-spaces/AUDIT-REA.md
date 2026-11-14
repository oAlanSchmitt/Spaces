# Auditoria REA — Spaces

Data: 14/11/2026. Alvo: alterações Spaces e operação paralela em `http://localhost:4410`; instalação oficial em `127.0.0.1:4310` preservada. Carga assumida: utilização pessoal neste PC Windows, não um serviço multiutilizador sob carga pública.

O Spaces acrescenta projetos protegidos, contexto e ferramentas internas ao servidor existente. Esta frente da auditoria cobre arranque/paragem, backup/restauro, proveniência, perfil Codex e ligação das provas à execução; a auditoria Ponytail independente cobre os fluxos de domínio, filas e interface. Não se apresenta esta leitura como auditoria de todo o código upstream.

## Método e cobertura

Foram relidos os quatro scripts públicos em `scripts/rheo`, os testes de manutenção, `spaces-codex-probe.ts`, `spaces-codex-native-proof.ts`, a factory/transporte `spaces-codex.ts`, o cliente upstream `CodexAppClient` e os pontos de shutdown nativo. Fonte completa e JavaScript distribuído legível foram suficientes: **nenhum comando REA, sessão de instrumentação ou nova instalação foi necessário**. Os contratos do CLI são os schemas gerados pelo executável instalado, não os da branch principal de outra versão.

As observações de execução reutilizam os recibos privados do piloto, a matriz OS e o canário nativo já autorizados. A primeira passagem acrescentou contraexemplos locais, testes sintéticos e leitura de metadata do processo, sem novo prompt. O achado REA-05 exigiu posteriormente um único turn diagnóstico adicional, autorizado pelo coordenador no âmbito da correção, com dados sintéticos e sem retentativa. Não houve novo login, leitura de credenciais, DB oficial ou documentos de clientes.

| Pergunta | Evidência e conclusão | Limite |
| --- | --- | --- |
| O Stop pode terminar o oficial por PID reutilizado? | Valida executável, birthtime, origem, data directory e supervisor; fecha somente o stdin conservado pelo supervisor próprio. Teste de processo alheio recusado e ciclos reais com saída limpa. | Não é proteção contra outro processo do mesmo utilizador a alterar ficheiros/identidades concorrentemente. |
| O backup é frio e recuperável? | Lock SQLite real do PGlite, `.env` obrigatória, hashes, diretórios vazios e restauro sintético com reabertura e consulta. Ciclo real copiou 2034 ficheiros. | Não inclui aplicação executável nem login Codex; não prova recuperação após perda do disco. |
| Um restauro parcial pode iniciar workers? | Achado REA-02 reproduzido e corrigido: hold antes do payload, guard do destino e nova validação do hold dentro do guard de Start. | Libertar o hold exige revisão de versão, jobs e efeitos externos; não há bypass automático. |
| As provas pertencem à configuração corrente? | CLI/hash/config/home/workspace/perfil/SO conferidos; oráculo independente e SHA revalidados pelo leitor. | Hashes privados são integridade, não autenticidade contra quem pode reescrever prova e oráculo. |
| Conversas reutilizam sessões antigas? | Cada `subscription.stream` cria cliente novo e `thread/start` com `ephemeral=true`; não usa `thread/resume`. O cliente partilhado serve metadata/login. | Não prova retenção zero pelo fornecedor remoto ou ausência de qualquer estado interno do CLI. |
| O perfil impede execução nativa nesta versão? | OS 13/13; duas células exatas receberam erros nativos correlacionados, sem efeitos sintéticos observados. | Observação finita; CLI continua dependência confiada. Não é prova universal de todas as capacidades. |

## Achados e correções

### REA-01 — Evidência contraditória podia ser aceite pelo parser — corrigido

**Gravidade:** alta para a confiança da prova. `summarizeNativeProbe` deduplicava chamadas por `call_id` e escolhia o primeiro output: uma terceira chamada com ID repetido e código diferente desaparecia; outputs extra ou contraditórios também eram ignorados. Os três contraexemplos puramente sintéticos devolveram `observed-blocked` antes da correção.

**Correção:** o Harness passou a exigir exatamente duas chamadas e dois outputs, IDs únicos e correspondência 1:1; frames repetidos também são recusados, pois não existe contrato observado que os justifique. Contraprova independente: baseline continua `observed-blocked`; os três casos passam a `inconclusive`. Os 10 testes nativos passaram com 28 asserções. A prova real existente continua aceite pelo leitor, sem repetir o modelo.

Reprodução privada: `.rheo/probes/audit-proof-counterexamples.ts`. Fonte/testes: `apps/server/src/spaces-codex-native-proof.ts` e `apps/server/test/spaces-codex-native.test.ts`.

### REA-02 — Falha ou concorrência no restauro deixava payload sem hold — corrigido

**Gravidade:** alta para recuperação. Restore escrevia o hold somente depois de todas as cópias/verificações e não conservava o lock de manutenção do destino. Uma falha depois de copiar bytes deixava uma pasta parcial que Start podia tratar como utilizável; o teste também confirmou que outro processo conseguia adquirir o lock durante a cópia. Um hold criado depois do primeiro check de Start era ignorado.

**Correção:** Restore adquire `.rheo-start.lock`, recusa runtime/lock nativo concorrente e grava o hold antes de criar/copiar o payload, conservando-o se falhar. Start volta a verificar o hold depois de adquirir o mesmo guard. Reutiliza os mecanismos existentes, sem novo formato de backup, campos de configuração ou framework. Se outro Start ganhar o guard primeiro, Restore recusa antes de copiar; isto não torna o filesystem transacional contra processos do mesmo utilizador.

**Reprodução:** dois testes em `scripts/rheo/runtime.test.ts`. O primeiro pausa uma cópia real, tenta abrir o lock num processo separado e corrompe bytes já copiados antes do hash real; exige erro, hold durante/depois da falha e nenhum runtime. O segundo cria um hold entre o precheck e o guard de Start; um `server.lock` sintético garante que nem a versão anterior pode iniciar servidor. Ambos falharam antes do patch e passaram depois: 2 testes, 10 asserções. Os injetores são ficheiros temporários de teste, não hooks do produto.

### REA-03 — Ambiente do launcher não reproduzia o digest atestado — corrigido e aplicado no piloto

O Start omitia `WINDIR`, `ProgramFiles`, `ProgramData`, `OS` e `PROCESSOR_ARCHITECTURE`, que a factory Codex inclui na sua allowlist. Simulação a partir do launcher anterior produziu `ef08c2b1…`, recusado pelo leitor, enquanto o ensaio usou `fc44f7a3…`. A allowlist foi alinhada com essas cinco variáveis não secretas. A configuração do perfil e o validador não foram afrouxados.

Nesse ciclo, o launcher e o standalone produziram o mesmo digest completo `fc44f7a3592864a6962eb5287ee1db4871fe9a6872d79753b4ff83eb3eb5cc0b`, aceite pelo leitor em ambos. O reinício unificado aplicou a allowlist ao PID 33188. O coordenador observou por CUA o card “Pronto para usar / Versão 0.167.0-alpha.4.1”: o mapeamento UI testado exige `installed`, `connected`, `compatible` e `sandbox=ready`. Assim se confirmou a paridade efetiva daquela execução/prova, sem leitura de API raw ou cookies por este especialista. A dependência restante do PATH herdado foi identificada e tratada em REA-05.

### REA-04 — Notificações de metadata da versão instalada rejeitadas no primeiro E2E — corrigido e E2E verificado

Às 17:31, o coordenador tentou responder à pergunta normal já existente e observou `ProviderError: Codex attempted an unsupported native operation`. A lista local de métodos aceites omitia `thread/settings/updated` e `turn/moderationMetadata`; ambos aparecem na lista `notificationMethods` do canário real e nos schemas do CLI instalado. Qualquer um deles, associado ao thread corrente, reproduz o ramo de erro. O relatório preservou nomes, não os payloads desses eventos; sem o nome do evento no erro normal, não se atribui o primeiro disparo com certeza a um deles.

Fontes offline: `.rheo/protocol/schema/v2/ThreadSettingsUpdatedNotification.json`, `TurnModerationMetadataNotification.json`, `WarningNotification.json`; `.rheo/probes/factory-thread-metadata.json`; relatório `native-0a20e948-2fde-4cd7-928e-de3a6e446473/native-probe-result.json`; dispatch JSON-RPC em `apps/server/runner/brain-codex-app.ts`.

O schema de settings exige `threadId` e `threadSettings`, incluindo `cwd`, `approvalPolicy` e `sandboxPolicy`. O perfil ativo é opcional/nullable. A resposta de thread real guardada, que usa o campo `sandbox` em vez de `sandboxPolicy`, mostra workspace dedicado, `approvalPolicy=never`, `{type:readOnly,networkAccess:false}` e perfil `{id:spaces-closed,extends:null}`. O schema readOnly permite omitir `networkAccess`, com default false; a projeção legada não comprova as regras de negação do perfil nomeado. `turn/moderationMetadata` exige thread/turn IDs e um campo `metadata` sem conteúdo de execução especificado. `warning` exige só `message`, com thread opcional.

Uma notificação JSON-RPC sem ID só chega ao listener; mensagens com ID seguem o handler de requests, que permanece negado. O ajuste seguro é reconhecer apenas os eventos conhecidos/scoped, validar invariantes de settings e não transformar metadata em configuração, output de agente ou autorização. Métodos desconhecidos, requests nativos e items de ferramenta continuam bloqueados. Fixtures devem declarar que combinam o schema instalado com a metadata real de thread, sem fingir um payload de evento capturado. A elegibilidade visual “Pronto para usar” continua distinta de compatibilidade funcional de uma conversa completa. Nenhum modelo ou restart adicional foi executado nesta investigação offline.

O Harness entregou o patch restrito, com 28 testes/108 asserções, types e Biome verdes: settings exige cwd dedicado, aprovação never, perfil spaces-closed sem extends e sandbox readOnly sem rede; moderation/warning válidos são descartados como metadata. Requests/items e métodos desconhecidos continuam negados; o erro passou a incluir só o nome canónico do método. A leitura independente confirmou essas condições. O reinício de compatibilidade carregou o patch no PID 39568; launch/perfil/prova não mudaram.

**Fecho integrado comunicado pelo coordenador:** às 17:52, a retentativa normal mostrou “Coordenador respondeu” e uma resposta real em português. Às 17:53, o coordenador global criou `Validação automática Spaces (teste)` no destino explícito; o novo card foi encontrado no catálogo e aberto, com conversa vazia, Conhecimento 0 e Fontes 0, sem o briefing do projeto anterior. Estes ensaios foram executados pelo coordenador, não repetidos pelo auditor REA. A criação e abertura pelo catálogo estão verificadas; o URL relativo da resposta motivou um ajuste posterior de apresentação com `appPageLink`, 3 testes/14 asserções e tipos de engine/server sem erros, sem novo clique numa resposta absoluta de modelo.

### REA-05 — PATH efémero invalidava a prova após novo arranque — corrigido e revalidado

Após a interrupção, o piloto PID 26288 iniciou com saúde/DB OK, mas mostrou “Conta ligada · Isolamento pendente”. O canário OS desse daemon passou 13/13 com digest `d77bdca4…38c9`, enquanto a prova nativa anterior pertencia a `fc44f7a3…cc0b`. CLI, versão, SO, home, workspace e perfil coincidiam. A factory incluía o PATH inteiro no digest; o ambiente atual continha um diretório temporário `codex-arg0…`. O ambiente antigo completo não foi retido: não se tentou reconstruí-lo nem atribuir toda a diferença exclusivamente ao PATH. A recusa do leitor foi correta.

**Correção mínima:** em Windows, `spacesCodexLaunch` fixa o PATH do filho em System32 e WindowsPowerShell/v1.0; o executável Codex já é resolvido antes do lançamento. Não altera permissões, argumentos, autenticação, hash da prova ou validador. O coordenador reproduziu o teste vermelho com dois PATHs diferentes e obteve igualdade após o patch; comunicou 25 testes/106 asserções, zero falhas, typecheck de servidor 0 e Biome limpo.

**Uma revalidação real:** o script existente `apps/server/scripts/probe-spaces-codex-native.ts` foi executado uma vez com o CLI absoluto e SHA-256 previamente conferido. O precheck OS passou 13/13 antes de abrir o único turn; o timeout do turn é 90 s, com limites existentes de output e sem retries. Às **23:36:26 UTC**, `native-6c500536-2119-4ad0-949e-e19b5d423189` terminou `completed`/`observed-blocked`: duas chamadas e dois outputs correlacionados, zero escritas e zero hits HTTP. A prova anterior foi preservada como `previous-native-tool-boundary.json` nesse diretório.

A configuração nova é `f3931e9a1caa2f3a76f7e47b5e465e1bfef18a1bb32007b28fbca0eb43fdc00b`; o CLI conserva SHA-256 `83f5c2dd2ac2902e0d96ba5d8ccdd27d513f57df4a9ab73e06a5a518028e9a2f`. O oráculo anterior ao turn tem SHA-256 `a703549c3a9c6301983faad60cc99c91a5064155721be6b746de2e15ddfbf2a9`. O leitor de produção aceitou a prova tanto no ambiente da shell como na simulação da allowlist do launcher, com o mesmo digest. Canário OS: `32d19986-4ea8-481a-9a18-b32dcd739047/probe-result.json`. A confirmação do daemon real após carregar o patch e do cartão pronto pertence ao fecho operacional do coordenador; não se repete a criação E2E já comprovada.

## Evidência existente e proveniência

- Bun privado: 1.4.4, SHA-256 `EE4B6285606E141E677F6102A3985C33BA76348A4B067535C9589E3C1F996670`. Caminho exato do executável de origem não foi registado pelo coordenador; não se procurou em ficheiros pessoais para o reconstruir.
- O hash `E5B83C…` é do JavaScript distribuído `web/runner/agentes-runner.mjs`, não do Bun nativo. A instalação oficial 0.8.4 não foi mapeada a um commit de fonte; a comparação estática não estabelece equivalência global.
- Canário nativo anterior: `.rheo/pilot-data/spaces-codex/probes/native-0a20e948-2fde-4cd7-928e-de3a6e446473/`, às 16:51:33 UTC. Oráculo gravado antes de `turn/start`, SHA-256 `aa1574b79a80fe20f956e372475008bd53b7f97500e43e40359543c6f20c6e2e`. Exatamente duas chamadas `exec`, dois outputs por IDs próprios `code-mode host is disabled`, zero escritas e pedidos HTTP observados. O primeiro ensaio tinha sido inconclusivo. REA-05 acrescentou posteriormente o terceiro turn diagnóstico do histórico, único sob o PATH determinístico; não houve conversa normal por este especialista.
- O restauro exige `.env`, preserva os bytes necessários à cifra das credenciais da instalação e mantém o perfil de login Codex fora da cópia. DACL nova protege backups/restauros com utilizador atual e SYSTEM; não se promete cifragem, autenticação criptográfica do backup ou versão executável incluída.

## Peso observado e contraponto Ponytail

Às 17:02:05 UTC, metadata do **servidor Spaces PID 5168** mostrou working set de **453,69 MiB**, memória privada comprometida de **1089,96 MiB**, 28 threads e 724 handles. Consumiu 31,25 ms de CPU numa janela de 1,020 s. As provas sintéticas ocupavam 0,181 MiB em 25 ficheiros. Recibo privado: `.rheo/probes/runtime-footprint.json`. O sandbox não observava o PID externo; a medição autorizada fora dele confirmou o processo correto.

É uma amostra de um processo, sem baseline, carga controlada, browser, CLI ou aplicação oficial incluídos. **Não mede watts nem demonstra que o produto completo é leve.** O auditor Ponytail mediu separadamente o hash do CLI: streaming de 1 MiB preservou o SHA e reduziu o pico do algoritmo face a ler os 373,7 MB de uma vez. Concordo com esse ganho local; não o converto numa poupança global da aplicação. A validação ainda relê o executável para conferir a identidade; nenhum cache foi acrescentado sem justificar a invalidação de segurança.

Foi obtido contraponto independente do auditor Ponytail para o restauro: concordou com reutilizar o guard existente, manter hold na falha e recusar concorrência antes do payload. Os achados de paginação, case folding e arquivo/filas pertencem à auditoria paralela e não são recontados como descobertas desta frente.

## Veredito e pendências

Fecho pelo coordenador: o PID 26288 saiu limpo e o PID 44740 ficou ready às 23:38:07 UTC. O probe do daemon às 23:38:14 passou 13/13 e coincidiu com a prova nova em `f3931e9a…fdc00b`; a interface mostrou **Pronto para usar**, com captura privada `Spaces-final.jpg`. O oficial em 4310 recusou conexão na última consulta e foi preservado, sem reinício ou modificação. Recibo `.rheo/pilot-final-recovery.json`.

Os achados REA-01 a REA-05 têm correção concreta e verificação, incluindo a conversa normal posterior ao patch de compatibilidade e a nova prova após tornar o PATH determinístico. A suíte de manutenção e canários OS passou com **12 testes, 71 asserções, nenhuma falha e um skip de junction no sandbox**, em 50,58 s; os quatro scripts passaram no parse e os ficheiros TS/JSON no Biome. O lote afetado pelo PATH passou com 25 testes/106 asserções. Não surgiram razões para instalar ferramentas ou introduzir dependências; apenas REA-05 exigiu uma nova chamada diagnóstica de modelo.

Após o freeze da auditoria, houve o ciclo PID 5168→33188, com saída limpa e ready às 17:28:38 UTC, registado em `.rheo/pilot-audited-restart.json`. O coordenador confirmou o card “Pronto para usar”; o primeiro E2E expôs REA-04. Depois do patch e novo freeze autorizado, o ciclo de compatibilidade PID 33188→39568 terminou às 17:48:55 UTC, também com saída 0/graciosa e saúde/DB próprias e oficiais OK; recibo `.rheo/pilot-compat-restart.json`. Nenhum modelo por este especialista em ambos os ciclos. Os E2E normais posteriores foram confirmados pelo coordenador, como descrito em REA-04. Estes PIDs são históricos; a disponibilidade após a interrupção é conferida no fecho operacional. Não foram avaliados carga sustentada, energia elétrica, recuperação após perda do disco ou comportamento de outra versão do CLI/SO.
