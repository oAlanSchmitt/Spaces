# Spaces no Windows

O piloto usa `http://localhost:4410`, Bun privado em `.rheo/runtime/bun.exe` e a interface compilada em `apps/web/dist`. O padrão dos scripts é `.rheo/data`; o piloto efetivamente iniciado em 14/11/2026 usa **`.rheo/pilot-data`**, conforme a escolha do coordenador. Passar o mesmo `-DataDirectory` em todos os comandos. A origem difere de `http://127.0.0.1:4310`, usado pela aplicação oficial: cookies são separados por host, não por porta. O diretório oficial não é entrada destes scripts.

Requisitos: PowerShell 7, dependências do repositório disponíveis, build web concluído e o runtime com SHA-256 registado em `origin-manifest.json`. Não há instalação de desktop, serviço, autostart ou atalhos. Executar os comandos a partir da raiz do fork.

## Contrato de arranque e paragem

```powershell
./scripts/rheo/Start-Spaces.ps1 -DataDirectory .rheo/pilot-data
./scripts/rheo/Stop-Spaces.ps1 -DataDirectory .rheo/pilot-data
```

Start valida os caminhos e o hash do runtime, fixa `PORT=4410`, `PUBLIC_URL=http://localhost:4410`, `WEB_DIR` absoluto, `BUN_BE_BUN=1`, `TELEMETRY=off` e `MACHINE_PROVISIONING=off`. O ambiente do filho é reconstruído com apenas variáveis básicas do Windows; credenciais de fornecedores e configurações como `HOST_COMPUTER_TOKEN`, `OWNER_KEY_SHA256` e `OWNER_CLAIM_SHA256` não são herdadas. `--no-env-file` impede o carregamento automático de `.env` da pasta do repositório. O código nativo conserva a configuração da própria pasta de dados.

A allowlist inclui `WINDIR`, `ProgramFiles`, `ProgramData`, `OS` e `PROCESSOR_ARCHITECTURE`, além das variáveis básicas anteriores. Essas cinco entradas também participam do ambiente filtrado da factory Codex; omiti-las produziu um digest diferente do canário standalone. O alinhamento preserva a configuração atestada e não transporta configurações ou credenciais do utilizador. O reinício auditado aplicou esse ajuste ao processo PID 33188.

Um supervisor PowerShell oculto lança apenas o Bun privado sobre `apps/server/src/native.ts --data <pasta> --until-stdin-ends`. Conserva o pipe stdin do seu filho. Stop valida diretório, PID, instante de criação e executável, supervisor original e metadados nativos; depois escreve um pedido privado identificado pelo lançamento. O supervisor fecha o stdin do seu próprio filho, acionando o encerramento nativo com drenagem e fecho do PGlite. Não usa `Stop-Process`, `taskkill` ou sinais enviados a PIDs arbitrários. Se a identidade divergir ou o processo não terminar em 60 segundos, recusa continuar. CIM não é necessário: a consulta Win32_Process foi observada indisponível neste PC.

Start devolve JSON `status=ready` somente depois de o PID próprio corresponder a `server.json` e `/api/health` responder HTTP 200. O loop de readiness tem timeout de 90 segundos e pede encerramento gracioso; esse prazo começa depois dos pré-requisitos/ACL/hash e não limita a duração total do comando, nem prova ausência posterior de processo. Stop devolve `stopped` com recibo de saída limpa do próprio supervisor, ou `already-stopped` depois de confirmar exclusividade da DB. Estes recibos não demonstram login, interface aceite ou execução de modelo.

Metadados operacionais ficam na pasta de dados, em `.rheo-runtime.json` e `.rheo-last-exit.json`; saídas do filho em `logs/launcher-stdout.log`, `logs/launcher-stderr.log` e no log nativo. Nenhum comando imprime o ambiente ou o conteúdo de credenciais. O servidor inicia os seus workers nativos; não inicia o runner de computador nem o updater desktop. A política de ferramentas protegidas continua responsabilidade do gateway.

O primeiro arranque no sandbox falhou em `linkSync` do lock nativo, com EPERM, sem abrir a DB. O mesmo comando fora do sandbox foi aprovado e devolveu ready: PID 13200, versão 0.1.1, PG18/PGlite 0.5.8. A verificação pública seguinte respondeu `status=ok`, `database=ok`, `edition=selfhost`, `modules=[]`. O sandbox também recusou sockets locais da shell; a verificação foi feita fora dele. Não foi necessário modificar o core para contornar estas limitações. PID é evidência daquele arranque, não um identificador durável.

## Backup e restauro

```powershell
./scripts/rheo/Stop-Spaces.ps1 -DataDirectory .rheo/pilot-data
$receipt = ./scripts/rheo/Backup-Spaces.ps1 -DataDirectory .rheo/pilot-data | ConvertFrom-Json
./scripts/rheo/Start-Spaces.ps1 -DataDirectory .rheo/pilot-data
# O destino deve ser novo; este comando não arranca nem substitui o piloto.
./scripts/rheo/Restore-Spaces.ps1 -BackupPath $receipt.backupPath -Destination .rheo/restored-pilot
```

Backup exige o fork parado e `.env` regular presente; não para nem reinicia processos por conta própria. O mesmo lock de manutenção impede Start durante a cópia. Um helper Bun oculto segura o lock SQLite real do PGlite até terminar a cópia: a presença de `db.lock` no disco, por si só, não indica DB aberta. O helper não abre os dados Postgres. Copia integralmente `db` e `.env`, mais `files`, `owner-key` e `host-computer-token` quando existem, incluindo diretórios vazios. Acrescenta manifesto de origem/versão, identidade do código/runtime/web e hashes SHA-256 de todos os ficheiros copiados. Um manifesto válido é escrito apenas depois da verificação.

As cópias ficam em `.rheo/backups/<data-UTC>-<id>`, fora do Git, com DACL protegida contendo somente FullControl para o utilizador atual e SYSTEM. As regras de acesso anteriores são substituídas, preservando proprietário e auditoria existentes. A gravação usa `FileSystemAclExtensions.SetAccessControl`: o cmdlet `Set-Acl` pediu `SeSecurityPrivilege` no diretório real, embora passasse na fixture; nenhum privilégio foi habilitado. **Não são cifradas e podem conter credenciais**: manter privadas, sem envio para Git, partilhas ou serviços externos. Não há eliminação ou retenção automática.

Restore aceita apenas cópias sob `.rheo/backups` e destino novo sob `.rheo`; exige `.env` listado e íntegro e recusa caminhos de escape, reparse points, membros duplicados, ficheiros não listados e hashes divergentes antes de criar o destino. Depois de criar o diretório privado, segura `.rheo-start.lock`, recusa runtime/lock nativo concorrente e grava o hold antes de copiar o payload. A cópia é verificada novamente depois de escrever. Nunca sobrepõe ou elimina recursivamente dados. Uma falha de escrita deixa a pasta nova parcial com hold para inspeção; escolher outro destino numa nova tentativa.

Todo restauro recebe `.rheo-recovery-hold.json`. **Start recusa essa pasta enquanto o hold existir**, antes de iniciar workers, e volta a verificar o hold dentro do mesmo guard de manutenção usado por Restore. O hold permanece numa falha após começar o payload. Não há opção de bypass no script. O coordenador deve rever versão compatível, credenciais, jobs e rotinas pendentes, reconciliar efeitos externos e só depois libertar explicitamente o diretório. `started=false` por si só não pausa rotinas. Código, runtime e interface não estão incluídos nesta cópia de dados: preservar a versão compatível indicada por `metadata/code-identity.json`; `workingTreeDirty=true` significa que só o commit base não reproduz o código utilizado. Hashes detetam corrupção; não autenticam uma cópia cujo manifesto e payload tenham sido ambos alterados. Os guardas não oferecem proteção contra troca concorrente de junction por outro processo com os mesmos privilégios do utilizador.

O perfil de subscrição `spaces-codex` também fica fora deste backup de dados. Os scripts não copiam login ou ficheiros de autenticação Codex; um restauro requer ligação normal no perfil dedicado, quando essa ligação estiver elegível e autorizada.

O ponto de recuperação é o estado frio dos ficheiros no instante da cópia. Não existe um RPO automático; alterações posteriores ao último backup não estão nessa cópia. O ensaio inclui PGlite sintético criado em disco, recusa de backup enquanto aberto, fecho, cópia, restauro, reabertura e consulta da linha esperada. Prova essa recuperação sintética e preservação de bytes/configuração, não integridade de dados reais ou recuperação após perda do disco.

## Proveniência e diferenças instaladas

Registo estático de 14/11/2026 em `origin-manifest.json`: desktop oficial 0.8.4, servidor 0.1.1, PGlite 0.5.8, PG18. O SHA-256 do bundle oficial foi medido, mas não mapeado a um commit. A leitura de trechos legíveis de JavaScript distribuído e fonte estabeleceu a lógica de `nativeEnv`, `run`, `dump`, `restore` e `ownerSignIn`, sem executar ou instrumentar a aplicação oficial. Não foi necessário abrir sessão REA para repetir leitura textual.

O Bun privado tem SHA-256 `EE4B6285606E141E677F6102A3985C33BA76348A4B067535C9589E3C1F996670` e respondeu versão 1.4.4. A cópia foi fornecida pelo coordenador a partir do runtime nativo oficial; o caminho exato do executável de origem não foi registado. O hash `E5B83C965ED5844B554A855F750592A6E1A734EBED0F40A56502AF4DD22012A5` pertence ao JavaScript distribuído `web/runner/agentes-runner.mjs`, um artefacto diferente. O manifesto conserva essa distinção sem procurar ficheiros pessoais para reconstruir a origem.

Os 253 SQL comuns têm hashes iguais. A fonte tinha 17 SQL adicionais no momento da comparação (incluindo as migrações Spaces). O arranque aplica migrações: não usar a pasta oficial para experimentar. `db dump` nativo é somente SQL, não substitui a cópia integral acima. O backup desktop descrito na fonte inclui db/files/.env e omite owner-key; um dono criado sem senha depende do login privilegiado desktop ou de uma senha definida posteriormente.

O link “Criar um” do diálogo desktop de adicionar workspace chama o onboarding Cloud na fonte correspondente à imagem fornecida; o executável desktop não foi descompilado. O web bundle carregado pelo instalado esconde a criação local no ramo de grupos desktop, embora contenha a rota local `/onboarding`. A fonte do fork já oferece esse item nativo no servidor próprio. A criação local usa a API da origem atual.

Numa pasta nativa nova sem `OWNER_*`, a fonte permite criar a primeira conta por email/senha no browser. `/api/auth/owner-key` é bootstrap privilegiado: valida um hash e emite um token de início de sessão de uso único. Não é o fluxo normal do browser nem justifica transportar a chave oficial.

## Verificação e primeiro login

Implementação autorizada: quatro scripts, guardas partilhadas em Stop, testes sintéticos em `scripts/rheo/runtime.test.ts` e esta documentação. Os testes executam os comandos reais sobre pastas geradas sob `.rheo/tests`; não usam DB oficial, cookies ou chamadas de modelos.

```powershell
$env:BUN_BE_BUN = '1'
./.rheo/runtime/bun.exe test scripts/rheo/runtime.test.ts apps/server/test/spaces-codex-probe.test.ts
```

Resultado final do lote de manutenção e canários OS: **12 testes passaram, 1 ignorado, 0 falhas, 71 asserções**, em 50,58 s. Inclui falha real de hash após cópia, lock concorrente no destino e hold criado entre o precheck e o guard de Start, sem iniciar servidor nesses ensaios. O único skip é a fixture de junction, cuja criação o sandbox recusou com EPERM; a guarda existe mas esse caso não foi executado neste ambiente. O ensaio de ACL verificou a DACL final exata; a tentativa de acrescentar Everyone explicitamente à fixture foi suprimida pelo sandbox, portanto a remoção desse grant prévio não foi reproduzida aqui. Parse dos quatro scripts e formatação/lint dos ficheiros TypeScript/JSON também são verificações separadas.

O ciclo real do piloto foi verificado em 14/11/2026: processo anterior encerrou com `exitCode=0` e `gracefulRequested=true`; backup privado verificado de 2034 ficheiros em `.rheo/backups/20261114T160448750Z-ba8e70c959ec4399b4ae98ee3b66c1d9`, concluído às 16:05:13 UTC; reinício com PID 15876 e `/api/health` com `status=ok`, `database=ok`. Recibo em `.rheo/pilot-maintenance-result.json`. PIDs são observações daquele ciclo, não identidades duráveis.

Depois do build final e dos gates separados, uma nova paragem graciosa do PID 15876 e arranque com **PID 5168** carregaram o código e a interface atuais. Recibo separado em `.rheo/pilot-final-restart.json`. A verificação pública da aplicação oficial em 127.0.0.1:4310 respondeu `status=ok`, `database=ok`, sem sessão ou leitura de conta.

Depois do freeze da auditoria, um reinício encerrou o PID 5168 com `exitCode=0` e `gracefulRequested=true`, e iniciou **PID 33188** às 17:28:38 UTC de 14/11/2026. Recibo em `.rheo/pilot-audited-restart.json`; origem localhost:4410, `native.ts` e argumentos da pasta piloto conferidos. A saúde pública do piloto e do oficial respondeu `status=ok`, `database=ok`, `modules=[]`. O launcher inicia somente o Bun/servidor nativo com `MACHINE_PROVISIONING=off`, sem desktop/updater ou lançamento de runner host. Nenhum modelo foi executado neste reinício. O coordenador observou por CUA o card **“Pronto para usar / Versão 0.167.0-alpha.4.1”**. Pelo mapeamento UI testado, esse estado exige `installed`, `connected`, `compatible` e `sandbox=ready`; essa correspondência fecha a paridade efetiva do daemon/prova. A observação é da interface autenticada, sem leitura de cookie, chave ou API raw por este especialista.

O erro de compatibilidade encontrado no primeiro E2E exigiu outro ciclo autorizado após o patch do Harness: PID 33188 saiu graciosamente com código 0 às 17:46:46 UTC, e **PID 39568** ficou ready às **17:48:55 UTC**. Recibo encadeado em `.rheo/pilot-compat-restart.json`; saúde própria/oficial OK, entry/args/data conferidos. Os cerca de 2 min 9 s entre saída antiga e saúde nova são duração observada, sem causa de fase medida; o timeout de readiness não cobre todo o préflight. Não houve outro Start, canário ou modelo por este especialista no ciclo. Launch, ambiente, perfil e prova nativa permaneceram iguais neste ciclo. Depois, o coordenador confirmou resposta normal às 17:52 e criação/abertura do projeto sintético às 17:53.

O primeiro arranque foi conferido com recibo ready, PID próprio e localhost:4410, interface Spaces e conta sintética numa pasta nova. O ensaio posterior autenticado confirmou conversa real e criação/abertura por coordenador, sem runner conectado. O URL da ferramenta foi corrigido para o helper nativo absoluto e passou em 3 testes/14 asserções; não houve novo clique numa resposta absoluta. Aceitação humana e uso com clientes reais permanecem distintos destes ensaios.

## Canários da subscrição Codex

`apps/server/src/spaces-codex-probe.ts` exporta `probeSpacesCodex(client, options)`. O cliente só precisa de `request(method, params)`. As opções ligam a evidência a workspace, home, diretório de provas, versão, SHA-256 do executável, SHA-256 da configuração e nome do perfil. O schema gerado pelo CLI instalado anuncia `command/exec.permissionProfile`; o probe passa sempre `spaces-closed`, sem combinar `sandboxPolicy`.

Não há thread de modelo, login ou dados reais nos canários. O probe cria marcadores sintéticos e executa comandos determinísticos: leitura positiva em A, negação de B/home/DB sintéticos, escrita fora e dentro do workspace read-only, traversal e junction; verifica curl nativo e um listener HTTP positivo no host, depois exige TCP/HTTP em 127.0.0.1 e localhost negados sem sockets ou pedidos novos no listener. Códigos de saída, conteúdo esperado, ausência de ficheiros e contadores do listener sustentam o resultado. Processos, sockets e junction próprios são fechados; relatórios ficam privados na pasta de provas.

Na factory exata `createSpacesCodexRpc`/`spacesCodexLaunch`, com Codex `0.167.0-alpha.4.1` e SHA-256 `83f5c2dd2ac2902e0d96ba5d8ccdd27d513f57df4a9ab73e06a5a518028e9a2f`, **13/13 canários passaram, incluindo junction real**. Configuração observada: `fc44f7a3592864a6962eb5287ee1db4871fe9a6872d79753b4ff83eb3eb5cc0b`; evidência em `.rheo/pilot-data/spaces-codex/probes/e96f4a9a-0a90-40a9-955d-02b02873f026/probe-result.json`. Só depois da matriz completa é emitida attestation com scope `command-exec-filesystem-network`.

**Essa attestation não comprova uma superfície nativa sem ferramentas.** O inventário `codex debug prompt-input` sob a mesma configuração/ambiente/pasta ainda anunciou `functions.exec`, `functions.wait`, `functions.request_user_input`, `functions.request_user_input_async` e `clock.sleep`. `agents.enabled=false` retirou as ferramentas de colaboração que apareciam na configuração anterior. Snapshot e resumo em `.rheo/probes/factory-rendered-prompt-input.json` e `factory-summary.json`. O renderer de diagnóstico não aceita as instruções base específicas do thread app-server, pelo que o snapshot é uma observação separada, com esse limite.

`thread/start` efémero e `thread/read` de metadados funcionaram sem `turn/start`. Threads efémeros recusam `includeTurns=true`; foi usado `false`. A ajuda instalada não anuncia tool/eval sem modelo: `debug app-server` oferece apenas `send-message-v2`, que não foi executado. O efeito real de `code_mode_host=false` sobre `functions.exec` foi ensaiado separadamente depois do login humano, conforme o registo abaixo; encerramento por eventos não é a única barreira.

Os gates foram separados por autorização do coordenador: **login humano normal pode ser disponibilizado após os 13 canários OS; chamadas de modelo exigem também a prova nativa pós-login**. O utilizador concluiu o login normal no perfil dedicado, e o coordenador observou `connected=true` no browser. Não foram copiados ficheiros de autenticação. Nenhuma feature Windows, VM ou instalação foi habilitada.

No primeiro lote foram autorizados e executados dois turns diagnósticos sintéticos, sem conversas de negócio. O primeiro foi inconclusivo: o CLI emitiu `exec` sem namespace, permitido pelo schema, e o relatório ainda não preservava um oráculo literal independente. Esse resultado não foi promovido a prova. O segundo foi executado depois de corrigir e testar o verificador: `native-probe-input.json` foi gravado antes de `turn/start`, contendo os dois códigos esperados, nonces, listener, paths e pedido completo, com SHA-256 `aa1574b79a80fe20f956e372475008bd53b7f97500e43e40359543c6f20c6e2e`.

Às **16:51:33 UTC de 14/11/2026**, o resultado foi `observed-blocked`: exatamente duas chamadas nativas `exec` corresponderam aos códigos esperados, cada `call_id` teve um output próprio `code-mode host is disabled`, não apareceram outras chamadas nativas, escritas, pedidos HTTP ao listener ou nonces privados nos outputs. A matriz OS de 13 casos também passou nesse ensaio. Evidência privada em `.rheo/pilot-data/spaces-codex/probes/native-0a20e948-2fde-4cd7-928e-de3a6e446473/`; a prova foi aceite pelo leitor de produção `readSpacesNativeProof` com a identidade/configuração exatas. A revalidação adicional após drift de ambiente está registada abaixo.

A observação é finita e vinculada ao CLI, configuração, SO, home, workspace e perfil; o CLI continua uma dependência confiada. Não é uma prova universal de todas as capacidades nativas, nem aceitação de uma conversa normal pela interface. O relatório mantém `ready=false` como diagnóstico; a elegibilidade do produto é calculada pelo serviço, que volta a validar a prova privada e a identidade corrente. Saúde após o reinício e estado Codex “Pronto para usar” foram confirmados; o ensaio E2E de conversa normal e criação de projeto pelo coordenador continua separado.

O primeiro ensaio normal do coordenador, às 17:31, falhou com `Codex attempted an unsupported native operation`, sem resposta normal concluída. A análise offline encontrou notificações de metadata anunciadas pelo CLI 0.167 e observadas por nome no canário, mas omitidas na lista do transporte: `thread/settings/updated` e `turn/moderationMetadata`. O Harness corrigiu essa compatibilidade com fixtures do schema instalado, preservando os bloqueios de requests/items nativos e a validação de settings; comunicou 28 testes/108 asserções, types e Biome verdes. O evento exato que primeiro disparou o erro normal não foi retido. A correção foi revista por leitura e carregada no reinício de compatibilidade; a conversa real às 17:52 e criação/abertura às 17:53 passaram. O diagnóstico offline não usou nova chamada de modelo.

## Arranque reproduzível e revalidação final

Após a interrupção, o piloto retomou no PID 26288 às 23:24:23 UTC, com DB e saúde OK. A interface indicou conta ligada e isolamento pendente: os canários OS passaram, mas a configuração era `d77bdca4…38c9`, diferente da prova antiga. O PATH herdado continha diretórios efémeros do harness; a configuração anterior completa não foi retida, portanto não se atribui toda a diferença exclusivamente a esse campo.

A factory partilhada passou a fixar o PATH Windows do filho em `SystemRoot/System32` e `System32/WindowsPowerShell/v1.0`. O CLI já é resolvido antes; permissões, argumentos e validador continuam preservados. O teste de duas entradas PATH diferentes falhou antes e passou depois. O lote de transporte/provas passou em **25 testes/106 asserções**, server typecheck e Biome sem erros.

Um único novo turn diagnóstico às **23:36:26 UTC** revalidou a configuração `f3931e9a1caa2f3a76f7e47b5e465e1bfef18a1bb32007b28fbca0eb43fdc00b`: 13/13 canários OS; duas chamadas nativas bloqueadas com outputs correlacionados, zero escritas e hits HTTP. O leitor de produção aceitou a prova. Evidência em `.rheo/pilot-data/spaces-codex/probes/native-6c500536-2119-4ad0-949e-e19b5d423189/`, oráculo SHA-256 `a703549c3a9c6301983faad60cc99c91a5064155721be6b746de2e15ddfbf2a9`. A prova anterior foi preservada; são **três turns diagnósticos no total**, sem retries neste lote.

O PID 26288 saiu graciosamente com código 0; **PID 44740** ficou ready às **23:38:07 UTC**, com saúde/DB OK. O probe do próprio daemon `16114d98-d3f5-4d84-b594-e3babea16d9a`, às 23:38:14, passou 13/13 com o mesmo digest `f3931e9a…fdc00b`. O coordenador observou **Pronto para usar** na interface e guardou `.rheo/screenshots/Spaces-final.jpg`. Recibo privado `.rheo/pilot-final-recovery.json`. A última consulta ao oficial em 4310 recusou conexão; ele não foi reiniciado nem alterado.

## Atualização de pasta e briefing — 15/11/2026

A migração aditiva 0274 acrescentou os metadados de continuidade do projeto. Antes do arranque, o PID 44740 saiu graciosamente e o backup privado `.rheo/backups/20261115T003032470Z-cfb0538eda6c4efab556934e65d9e34e` foi verificado com 2035 ficheiros. Não é cifrado e não inclui código ou autenticação Codex. O PID 3964 ficou ready às 00:32:01 UTC, com saúde e DB OK; recibo `.rheo/handoff-maintenance.json`.

O probe normal `a963254a-d1b0-46c4-94cf-3c6b91fa4d29`, às 00:32:10 UTC, passou 13/13 com digest `f3931e9a1caa2f3a76f7e47b5e465e1bfef18a1bb32007b28fbca0eb43fdc00b`. A UI mostrou Pronto para usar. Transporte, permissões, workspace e perfil não mudaram; a prova nativa existente permaneceu aplicável, sem novo turno diagnóstico. O fluxo de pasta/briefing foi verificado no browser com dados sintéticos, sem aceder à pasta indicada. A instalação oficial não foi alterada.

**Resumo para validar:** quatro comandos locais isolam arranque, encerramento gracioso, backup privado e restauro para pasta nova. A instalação oficial permanece preservada; uso com dados reais depende de piloto funcional e recuperação verificada.

## Evolução de conhecimento e trabalho — 16/11/2026

O piloto anterior já estava parado. Antes de aplicar 0275/0276, o backup frio privado foi verificado às 12:38:50 UTC, com 2039 ficheiros e DACL privada. A cópia continua não cifrada e exclui o login Codex. O PID 41424 iniciou às 12:56:16 UTC, com saúde/DB prontas, catálogo Área → Espaço → Projeto e os painéis Conhecimento compartilhado e Trabalhar aqui.

A interface autenticada confirmou uma fonte comum sintética em dois projetos do mesmo Espaço e a ausência dela num projeto de outro Espaço. A pasta sintética associada resolveu para a raiz canónica autorizada. O painel de trabalho foi observado a 390/320, sem transbordo horizontal ou ações cortadas. As capturas estão privadas em `.rheo/screenshots/shared-knowledge-after-*.jpg` e `work-ready-after-*.jpg`.

A primeira matriz do perfil `spaces-work` passou 15/15 controlos reais de comandos, ficheiros e rede, sem modelo. O primeiro pedido real pela conversa falhou com `No usable execution environment is available`, sem ficheiros ou testes executados. O erro foi apresentado corretamente. A prova dos comandos não cobria o ambiente nativo do modelo.

O diagnóstico REA mostrou que enviar `environments: []` desativa esse acesso. Um único thread efémero sem modelo, em 1,75 segundos, observou o ambiente `local` pronto e a raiz correta ao omitir o campo. O PID 41424 foi encerrado graciosamente. A correção usa seleção local explícita e passa a vincular os parâmetros de runtime ao fingerprint da prova, exigindo nova matriz antes de habilitar o ensaio seguinte. Estes registos não afirmam ainda geração de imagem ou desenvolvimento concluído na conversa.

A prova v2 passou os 15 controlos reais com ambiente local explícito, e a prova anterior foi recusada. O leitor de produção confirmou a identidade atual, incluindo políticas de thread, resume e turno, com digest `8bbdd3ed436c56562c185e5b93bfebb5b33c7608710ac5be22cfa7aee5c98154`. O registo privado `work-v2-20261116-1794834940588-result.json` e o probe `399d1d76-1679-428f-9bfc-58b6144f1449` preservam a evidência. O PID 1868 reiniciou o piloto com o novo contrato, e o painel autenticado voltou a Pronto para trabalhar. A repetição real do pedido de código começou às 13:20 UTC.

### Resultado real e fecho

Às 13:21 UTC, a conversa devolveu três cartões de ficheiros: `entrega.html`, `soma.cmd` e `testes.cmd`. O HTML contém as duas cores e o marcador exclusivo da fonte comum do Espaço. O registo do comando `cmd.exe /d /c testes.cmd` apresentou os três casos de soma aprovados e saída 0. O coordenador leu os ficheiros reais e voltou a executar o teste, confirmando independentemente o resultado.

Às 13:24 UTC, a ferramenta nativa gerou uma imagem e o percurso seguro entregou um PNG de 1.653.885 bytes em `generated-images`, com cartão e pré-visualização na conversa. REA confirmou assinatura PNG, IHDR 1672 × 941, RGB de 8 bits e IEND. SHA-256: `77f416619d50c1a48e51c647a0dcb38628d2fa473e94d033002ac934f91224cd`. Uma tentativa adicional do modelo de copiar a imagem original do diretório Codex foi recusada. A imagem entregue através dos bytes inline permaneceu disponível, sem ampliar o acesso ao diretório da conta.

O ensaio motivou três correções finais: falhas exploratórias deixam de marcar uma entrega recuperada como erro global, ficheiros recebem URLs absolutos autenticados do Drive, e o prompt explica a entrega automática da imagem para evitar a cópia do original privado. Os comandos falhados continuam no registo. O teste negativo de destino final preexistente reproduziu uma sobrescrita por hardlink e sustentou a mudança para criação exclusiva `wx` no copiador confinado. Essas correções passaram nos testes próprios, sem repetir modelos nem alterar o perfil/prova.

O PID 1868 foi encerrado graciosamente e o **PID 13408** carregou o código final. A interface autenticada confirmou os quatro ficheiros/cartões, abriu a imagem no visualizador e confirmou persistência do documento comum e da associação pronta. As larguras temporárias foram repostas e o catálogo ficou aberto como entrega. Recibo privado: `.rheo/evolution-e2e-20261116.json`; capturas `Spaces-evolution-final-1280.jpg`, `Spaces-evolution-final-390.jpg` e `native-image-persisted-1280.jpg`.

Verificação final do coordenador: 74 testes UI/client/geometria com 649 asserções, 18 testes serviço/probe/prova com 140 asserções, tipos DB/engine/client/server/web, Biome de 48 ficheiros, boundaries, migrations e builds passaram. Lotes anteriores e auditorias sobrepostos estão nos seus relatórios, sem somar cobertura duplicada. A suíte global de traduções ainda assinala as chaves Spaces ausentes em doze idiomas do fork, situação que já existia na base; português e inglês têm as novas palavras e o check português passou. Os testes nativos dependentes de POSIX não foram executados no Windows. Não houve nova dependência de aplicação.

**Resumo para validar:** conhecimento comum por Espaço, desenvolvimento com três testes reais e geração nativa de PNG foram demonstrados dentro da conversa, com persistência após reinício. Os ensaios foram sintéticos, a toolchain local continua limitada ao perfil autorizado e a disponibilidade/quota de imagens pertence à assinatura. Não constituem garantia universal de isolamento, validação de todos os fluxos upstream ou aceitação humana.
