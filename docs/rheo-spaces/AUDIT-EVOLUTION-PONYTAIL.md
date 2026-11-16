# Revisão independente da evolução Spaces

Data: 16/11/2026. Base `9e4b5bf4ffbd3afe4316c1e7cb8d7600497a9a0a`, branch `feat/spaces`, incluindo alterações de trabalho posteriores. Revisão delimitada das alterações descritas na [ADR 0186](../adr/0186-spaces-shared-knowledge-and-local-work.md), não auditoria de todo o upstream.

Foi aplicada a skill pessoal Ponytail e a skill de revisão do plugin instalado 5.3.3. É uma revisão pontual, sem mudar flags, hooks ou configuração do host. O auditor não implementou código de produto e examinou chamadores, testes e fonte ligada. Carga assumida: piloto local com um proprietário, não uma implantação SaaS com múltiplos servidores.

## Resultado

Revisão encerrada sem achados materiais pendentes no âmbito examinado. O conhecimento partilhado tem origem canónica e revisões, e a execução reaproveita as classes, eventos, artefactos e registo de uso nativos. O coordenador comunicou código, testes e imagem reais na conversa, com persistência após carregar o build final. Não foi encontrada necessidade concreta de outro motor, biblioteca ou dependência para este âmbito.

O auditor verificou fonte e testes determinísticos; os resultados reais e visuais foram comunicados pelos responsáveis e estão separados abaixo. O piloto sintético não equivale a aceitação humana, validação de todos os fluxos upstream ou garantia universal de isolamento. A primeira tentativa real encontrou uma incompatibilidade que os mocks não representavam; o histórico preserva essa falha e a correção.

## Atualização após o primeiro ensaio real

O coordenador comunicou que a primeira tarefa real de código falhou com `No usable execution environment is available`, sem efeitos observados na pasta. O piloto foi encerrado graciosamente. Esta falha invalida qualquer interpretação dos quinze canários anteriores como prova de desenvolvimento funcional pelo modelo.

REA identificou no contrato instalado que `environments: []`, enviado no início do thread e do turno, excluía os ambientes de execução do modelo. `command/exec` funciona por um percurso diferente: os controlos positivos de comandos passaram, embora a ferramenta usada pelo modelo não tivesse um ambiente utilizável. Os testes com fornecedor e app-server falsos não representavam esta condição. A nota anterior sobre os limites da prova era correta, mas o teste real continuava indispensável.

A correção de fonte reutiliza `codexIsolatedPolicy` no início, retoma e turno do executor e no probe. Seleciona apenas o ambiente `local`, com pasta e raiz exatas. O matcher partilhado valida a resposta real em `thread.environments`, o perfil nomeado sem herança, aprovação `never`, fornecedor OpenAI, ausência de instruções do host e rede desligada. O executor consulta `environment/status` e recusa iniciar o modelo se o ambiente não estiver `ready`.

A identidade de configuração inclui agora o objeto completo de política de thread/turn, além de argumentos, ambiente e pasta. O leitor exige schema de prova 2 e rejeita o schema 1, mesmo que os antigos argumentos de lançamento coincidam. Não foi aberto outro executor nem afrouxada a fronteira de ficheiros/rede para resolver esta falha.

Verificação pontual independente: cinco testes e setenta asserções passaram após o alinhamento do matcher, ambiente e leitor v2. Os testes representam a resposta de ambiente local e a rejeição de configurações diferentes; não foram contados como nova execução do modelo. Durante a edição, três desses testes estiveram vermelhos enquanto os fixtures e o leitor ainda tinham contratos diferentes.

Naquela fronteira, a correção de fonte estava revista, sem novo achado no recorte, e a revalidação real dos canários v2 e os turnos de código/imagem ainda pertenciam ao trabalho do coordenador e do REA. O resultado de fonte e os testes mantinham o seu alcance, sem promover antecipadamente a implementação a entrega funcional concluída. Os resultados posteriormente comunicados constam abaixo.

### Resultado real comunicado após a correção

REA comunicou uma nova matriz v2 com quinze controlos reais aprovados, rejeição da prova v1 e aceitação do novo digest pelo leitor de produção. O coordenador comunicou, às 13:21, uma tarefa real de código concluída na conversa: três ficheiros/cartões entregues, marcador e cor do conhecimento comum preservados, `soma.cmd` e `testes.cmd` executados com três casos e saída 0. Estes resultados foram observados pelos respetivos responsáveis, sem execução repetida pelo auditor.

O ensaio revelou dois problemas de apresentação na fronteira da ferramenta: um comando exploratório falhado marcava o trabalho completo como erro mesmo depois de recuperação, e os ficheiros não forneciam ao Coordenador um URL absoluto, que acabou por escrever links relativos literais. Os cartões nativos funcionavam.

O parecer independente concorda com a menor correção proposta: conservar todos os resultados dos comandos em `calls`, deixando `isError` global para falha do transporte/turno, cancelamento ou entrega; acrescentar aos ficheiros o URL autenticado nativo do Drive com `appPageLink`. Um turno concluído continua sem equivaler a testes aprovados ou objetivo cumprido. Quota de imagem ou ferramenta indisponível tem de permanecer explícita no texto e nos eventos, nunca convertida em sucesso por existir `done`.

As duas correções de apresentação foram implementadas pelo Harness e relidas pelo auditor. Um teste específico independente passou com vinte asserções: comando exploratório falhado, teste posterior aprovado, turno concluído, dois cartões e URLs absolutos corretos. O erro exploratório permanece no registo. Não foram reescritos recibos históricos, alterado o filtro de URLs, iniciados modelos ou mudados perfis/permissões neste ajuste.

### Imagem real, correção final e persistência

O coordenador comunicou a geração nativa de um PNG às 13:24, com cartão e pré-visualização na conversa. REA comunicou a confirmação dos bytes e das dimensões, registada em [RUNTIME.md](RUNTIME.md). A cópia adicional que o modelo tentou fazer a partir do diretório privado da conta foi recusada; a entrega autorizada pelos bytes inline funcionou, sem conceder acesso à pasta da conta.

Na revisão final REA identificou que um ficheiro de destino já existente, incluindo um hardlink para fora do projeto, podia ser sobrescrito. O Harness reproduziu o caso e aplicou a menor correção no copiador: `writeFileSync` usa `flag: "wx"` apenas no modo confinado. O destino tem de ser criado de novo e um ficheiro preexistente causa recusa. O comportamento não confinado foi preservado. O auditor leu a alteração de uma linha e executou o recorte: quatro testes, vinte e uma asserções, zero falhas e um caso upstream POSIX ignorado no Windows. O conteúdo do ficheiro externo e dos destinos preexistentes permaneceu intacto no teste.

Depois do encerramento gracioso do PID 1868 e do build final, o coordenador confirmou o PID 13408 pronto. Pela interface autenticada, confirmou os quatro cartões persistidos, abriu o PNG no visualizador, encontrou o documento comum e a associação da pasta pronta para trabalhar. A inspeção a 1280, 390 e 320 não encontrou transbordo. A largura temporária foi reposta e o catálogo ficou aberto como entrega. O auditor não repetiu essas operações ou os turnos reais.

Verificações finais comunicadas pelo coordenador: 74 testes UI/client/geometria e 649 asserções, 18 testes backend e 140 asserções, tipos, Biome de 48 ficheiros, boundaries, migrações e builds passaram. Não foram somadas com os lotes sobrepostos do auditor. O recibo e os detalhes operacionais estão referenciados em [RUNTIME.md](RUNTIME.md). O âmbito técnico acordado está fechado; aceitação humana e utilização com dados reais conservam o seu significado próprio.

## Achados tratados durante o desenvolvimento

| Achado concreto | Correção observada na fonte e verificação |
| --- | --- |
| Retomar a mesma sessão Codex conservava conhecimento oculto antigo após revisão ou revogação das fontes. | Cada chamada de trabalho usa uma sessão nova por recibo e recebe o snapshot aprovado atual. O teste de duas chamadas confirma sessões diferentes e a substituição da versão antiga da fonte. Os ficheiros já criados continuam a existir e não são apagados pela revogação. |
| As tabelas de trabalho inicialmente não tinham âmbito de organização. | `rheo_project_work` e `rheo_work_turns` conservam `orgId` e chaves estrangeiras compostas para projeto e execução. As restrições UNIQUE correspondentes estão no schema e na migração aditiva 0276. |
| Um destino de imagens redirecionado por junction podia causar uma escrita privilegiada fora da pasta. | O modo confinado aceita apenas bytes inline e recusa o destino redirecionado. O ensaio independente com junction sintética devolveu erro e zero ficheiros no destino externo. Um resultado apenas por caminho ou identificador não é apresentado como imagem entregue. |
| Um ficheiro de imagem final preexistente, incluindo hardlink para fora do projeto, podia ser sobrescrito. | Criação exclusiva `wx` no modo confinado. REA identificou o problema e Harness reproduziu/corrigiu; o auditor confirmou a fonte e quatro testes específicos, com preservação dos bytes externos e do comportamento não confinado. |
| O handshake nativo sem a capacidade experimental não aceitava os campos de permissões nomeadas. | O auditor pediu verificação do handshake real. REA confirmou a recusa, e a capacidade foi habilitada apenas no host isolado. A projeção legada de sandbox não é utilizada como prova do perfil nomeado. |
| O cancelamento podia chegar durante a gravação do recibo, antes de o listener ser instalado. | O sinal já abortado é verificado após instalar o listener e imediatamente antes de iniciar o executor. Cancelamento, revogação e retenção do uso observado têm testes próprios. |
| O limite de vinte caminhos descartava eventos adicionais sem ativar a mensagem de omissão. | Um indicador de omissão acompanha o limite, sem guardar uma lista ilimitada. O teste envia mais de vinte ficheiros e um caminho exterior, confirma a mensagem e a ausência do conteúdo privado na entrega. |
| Projeto arquivado não permitia ler ou revogar a sua associação. | A autorização de leitura e revogação admite o estado arquivado. Associação nova e execução continuam recusadas. O teste do serviço cobre leitura e revogação pelo proprietário. |

## Verificações executadas pelo auditor

As contagens seguintes pertencem a lotes separados e sobrepostos. Não devem ser somadas como cobertura única.

| Lote | Resultado observado |
| --- | --- |
| Conhecimento, contexto, briefing, API e interface de conhecimento comum | 28 testes, 458 asserções, zero falhas. |
| Serviço de trabalho, leitor/probe de provas, mapper/host nativo e interface Trabalho | 35 testes passaram, 22 ignorados, zero falhas, 230 asserções. Os casos ignorados são testes upstream dependentes de POSIX, explicitamente desativados no Windows. |
| Serviço de trabalho após os últimos ajustes de cancelamento, transporte e omissão | 11 testes, 59 asserções, zero falhas. Inclui junction real, sessão nova, idempotência, limite de orçamento, interrupção, entrega e uso observado. |
| Contrato de ambiente e prova v2 | 5 testes, 70 asserções, zero falhas. |
| Recuperação de comando exploratório e URLs de entrega | 1 teste, 20 asserções, zero falhas. |
| Correção final de colisão/hardlink de imagem e comportamento não confinado | 4 testes passaram, 1 caso POSIX ignorado, 21 asserções, zero falhas. |
| Consistência das migrações | `check:migrations` devolveu `migrations ok`. |

O sandbox de desenvolvimento recusou criar a junction de teste com EPERM. O mesmo lote foi executado fora dele, com aprovação automática, usando apenas pastas e subprocessos sintéticos. Não houve leitura de credenciais, novo login ou chamada de modelo nessa revisão.

REA comunicou separadamente quinze controlos reais do novo perfil no CLI instalado, incluindo escrita positiva, fronteiras, rede e handshake. Esta revisão leu os contratos e os limites dessa prova, sem repetir os canários. Prova de comandos não demonstra disponibilidade de ferramenta nativa de imagem, quota da conta ou sucesso de uma tarefa de modelo.

## Limites materiais

- A alteração ou revogação de uma fonte impede a publicação e reutilização de contexto derivado, mas não desfaz comandos já executados nem remove ficheiros existentes.
- A entrega é limitada a vinte ficheiros por chamada e dez MB por ficheiro. Os restantes permanecem na pasta, com omissão assinalada.
- A imagem confinada depende de bytes que possam ser entregues com segurança. Um evento simulado demonstra o percurso técnico, não a capacidade ou quota da assinatura instalada.
- A prova está vinculada ao executável, configuração, host e pasta. Os controlos finitos não protegem contra um processo irrestrito com os mesmos privilégios Windows do proprietário.
- A revisão não executou os dois turnos reais finais, não verificou a interface no browser, não ensaiou carga PostgreSQL concorrente nem certificou todos os fluxos do upstream.

**Resumo para validar:** o âmbito técnico está fechado sem achados materiais pendentes nesta revisão. Conhecimento comum, código/testes e imagem foram demonstrados no piloto e os quatro cartões persistiram após o reinício final, conforme comunicado pelo coordenador. Foram corrigidos os erros de ambiente, estado, links e escrita de imagens. Aceitação humana e uso com dados reais não são presumidos.
