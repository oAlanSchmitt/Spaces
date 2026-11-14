# Parecer Maquiavel — Spaces

Data: 14/11/2026. Fork `oAlanSchmitt/Spaces`, branch `feat/spaces`, base upstream `071026d41f293d26cca480874cad5f66658d716c`. Revisão sobre a árvore de trabalho, incluindo correções ainda não commitadas. Âmbito: avaliar o plano e o melhor uso do piloto; sem modificar código, instalar ferramentas ou efetuar chamadas de modelo.

Foi aplicada a skill pessoal Maquiavel num subagente comum, pois esta sessão não anuncia um papel nativo Maquiavel. A revisão é independente da implementação, mas reutiliza as evidências identificadas pelos executores; não se apresenta como uma nova execução de todos os testes ou como aceitação de Alan.

## Decisão prática

**Fechar o piloto protegido e utilizá-lo antes de acrescentar capacidades.** O maior ganho atual vem da organização e do contexto controlado, não de aumentar o número de agentes. A arquitetura revista reutiliza a organização nativa por projeto e os mecanismos existentes de transação, autorização, fila, cancelamento e interface. Refazer essas camadas ou transformar o fork numa plataforma independente aumentaria manutenção sem resolver uma necessidade demonstrada.

O nome visível Spaces e a interface baseada no Design System do agentes.chat estão no fork. A aplicação oficial em `127.0.0.1:4310` e os seus dados conservam o seu âmbito; o piloto separado usa `localhost:4410`. A revisão não autoriza migração, instalação desktop, autostart, publicação ou uso de clientes reais.

O coordenador observou a conversa normal, a criação interna e a abertura do projeto sintético no processo reiniciado. **O fluxo sintético do piloto está verificado.** O link direto passou nos checks próprios. Após a interrupção, foi ainda corrigida a herança de PATH efémero; nova prova e daemon real coincidiram, e a interface voltou a Pronto para usar. Isso não transforma esta fase em versão completa para uso real. Aceitação humana continua distinta.

## O que já está resolvido

| Necessidade | Resultado e evidência | Limite material |
| --- | --- | --- |
| Encontrar e retomar iniciativas | Negócio → Espaço → Projeto no catálogo, criação/abertura/arquivo; `rheo-spaces.ts`, `RheoSpacesPage.tsx`, [USAGE.md](USAGE.md). | A árvore não concede leitura entre projetos. |
| Separar clientes e projetos | Organização, agente, canal e contexto próprios; `rheo-context.ts`, `rheo-policy.ts` e testes de contexto/política. | Isolamento lógico e perfil Codex observado; não protege contra o proprietário do PC ou um processo irrestrito com o mesmo utilizador. |
| Criar um projeto pela conversa | Coordenador global recebe metadados e propõe `rheo_create_project`; servidor resolve proprietário/destino e chave idempotente. | Não muda a conversa atual nem transporta histórico. Agentes de projeto não recebem criação global. |
| Guardar conhecimento útil | Documentos classificados, memória proposta/revista, itens de ação e inspector de fontes; `rheo-knowledge.ts`, `rheo-tools.ts`. | Só conteúdo aprovado para a equipa entra no contexto. Itens de ação vivem no Conhecimento e não são cartões do quadro Tarefas. |
| Impedir herança de poderes do computador | Gateway protegido, ferramentas internas identificadas pelo servidor e transporte que devolve propostas JSON; sem shell/browser/MCP/rotinas/publicação. | CLI e configuração fixados continuam dependências confiadas. Nenhuma promessa de retenção zero pelo fornecedor. |
| Corrigir falhas efetivamente encontradas | Duplicados por caixa, listas/ID exato, hash por stream, arquivo/filas, parser da prova e hold/lock de restauro: [AUDIT-PONYTAIL.md](AUDIT-PONYTAIL.md), [AUDIT-REA.md](AUDIT-REA.md). | As auditorias cobrem os fluxos ligados a Spaces, não todo o upstream. |
| Operar e recuperar sem substituir o oficial | Scripts separados, identidade de processo, encerramento gracioso, backup frio e restauro novo com hold; [RUNTIME.md](RUNTIME.md). | Backup privado não cifrado, sem executável e sem login Codex. Recuperação sintética não demonstra recuperação de clientes reais após perda do disco. |

A última correção de recibos foi inspecionada nesta revisão: `rheo-entry-payload.ts` é reutilizado por contexto e ferramentas, limita o JSON completo e torna corte/omissão explícitos. Os recibos derivam dos IDs efetivamente renderizados. O coordenador comunicou **14 testes/54 asserções GREEN** nesse ajuste; esta revisão não repetiu a suíte.

As correções foram escolhas proporcionais: stream de 1 MiB preserva a validação do executável sem buffer integral; o arquivo reutiliza `stopRun` e audit log; o restauro reutiliza o guard de manutenção. Não foram acrescentadas dependências de aplicação. O ganho medido do hash é local ao algoritmo; não há medição que permita anunciar poupança global de RAM, energia ou custo por tarefa aceite.

Há um limite operacional observado: no ciclo de compatibilidade, a saída do PID 33188 às 17:46:46 e o ready do PID 39568 às 17:48:55 estão separados por **2 min 09 s**. O timeout de 90 s descrito no launcher abrange o loop de prontidão depois do preflight, não todo esse intervalo. As causas não foram perfiladas; estes tempos não permitem atribuir custo ao hash, PGlite, prova ou outro passo. Antes de otimizar, separar os tempos de preflight e prontidão a partir de recibos/metadata disponíveis. Não foi pedido outro restart ou benchmark nesta revisão, nem se apresenta o produto completo como leve ou de arranque rápido.

## Lacunas atuais e opções futuras

| Estado | Capacidade | Consequência prática |
| --- | --- | --- |
| Ajuste de utilização verificado por teste | Conversa, criação interna e abertura pelo catálogo verificadas no PID 39568. O link relativo devolvido pela ferramenta apareceu como Markdown literal e passou a usar o helper nativo `appPageLink`. | `SAFE_URL` conservado; teste RED→GREEN, 3 testes/14 asserções e tipos engine/server sem erros. Não houve novo clique numa resposta de modelo com URL absoluto. |
| Limite assumido do piloto | Claude por assinatura ainda sem transporte equivalente validado. | A escolha exclusiva Codex/Claude não significa que ambos estejam disponíveis hoje. Codex não deve cair numa chave de API ou no executor legado. |
| Futuro opcional | Mais templates/especialistas internos versionados. | O perfil entregue é um coordenador; os nove especialistas usados no desenvolvimento não estão automaticamente instalados na aplicação. |
| Futuro opcional | Coleções/concessões entre projetos, quadro nativo, conectores e execução de desenvolvimento. | Permanecem fora do perfil atual. A necessidade deve justificar cada ampliação e a respetiva autorização/verificação. |
| Marco posterior de uso real | Atualização upstream ensaiada e recuperação/aceitação com dados explicitamente escolhidos. | A especificação original distingue este marco do MVP sintético. Não houve evidência de atualização upstream real nesta revisão. |

A especificação original de 961 linhas é uma referência de produto, não uma lista de funcionalidades já entregues. [DESIGN.md](DESIGN.md) regista a revisão autorizada: uma organização por projeto e piloto protegido mais estreito. As suas fases de partilha, equipa ampliada e manutenção não devem ser implicitamente marcadas como completas. A revisão não encontrou fundamento para criar outro especialista pessoal: Harness, Segurança, Curadoria, UI/UX e os restantes papéis disponíveis já cobrem estas decisões; um nome novo não substitui evidência.

## Reutilização na Devstore

O fork já é uma fonte local identificada; não se justifica outro clone ou instalação para aprender com ele. O [índice da biblioteca](../../../biblioteca/README.md) já cobre proveniência, recuperação e verificação. O contributo específico de Spaces é conservar exemplos concretos dessas regras:

- **Recibos do contexto renderizado:** limitar o payload antes de registar IDs evita atribuir ao modelo uma fonte que não recebeu. Pode orientar o inspector de fontes do Companion; exige preservar aprovação, visibilidade e revogação da solução de destino.
- **Revogação transitiva e arquivo com marca durável:** uma resposta derivada conserva dependências; arquivar invalida trabalho antigo mesmo depois de reabrir. Pode informar filas e conhecimento no Kopenion sem copiar tabelas ou o servidor inteiro.
- **Prova ligada à instalação real:** versão/hash/configuração/SO/perfil e oráculo anterior à execução evitam promover um ensaio de outra configuração. É um exemplo útil para Harness/REA, limitado ao comportamento finito observado.

A menor forma de aproveitamento é referenciar os exemplos e testes nas fichas existentes depois do fecho. Reutilizar componentes exige conferir o contrato e a licença AGPL/avisos do fork; não recomendo transportar o motor nem as dependências de Spaces para o Companion. Utilizar a ferramenta significa continuar o piloto atual, com os seus dados separados. Esta revisão não alterou a biblioteca, o Companion ou o Kopenion e não criou um especialista.

## Melhor uso agora

1. Usar o coordenador global para organizar destinos e criar projetos; trabalhar o conteúdo na conversa do projeto correspondente.
2. Começar com uma entrega pequena e sintética por projeto. Guardar decisões duráveis como memória proposta e revê-las; dar aos agentes somente os documentos aprovados de que precisam.
3. Consultar Fontes usadas para perceber o contexto disponibilizado e arquivar fontes/projetos quando terminarem. Para executar código, continuar a utilizar o ambiente de desenvolvimento já autorizado fora deste perfil protegido.

Multiplicar projetos para cada nota aumenta navegação e manutenção. Uma ideia permanece na Caixa de ideias até precisar de objetivo, entrega e contexto próprios. Copiar o mesmo documento entre projetos para contornar a ausência de partilha cria versões independentes; não deve ser apresentado como partilha sincronizada.

## Registo compacto de decisões

Plano de base: [2026-11-14-rheo-spaces.md](../superpowers/plans/2026-11-14-rheo-spaces.md), lido com [DESIGN.md](DESIGN.md). Não se alterou o objetivo autorizado. Custos de modelos, tokens totais e custo por tarefa aceite não foram medidos nesta revisão.

| Proposta | Evidência e delta mínimo | Custo/risco e menor verificação | Decisão e autoridade |
| --- | --- | --- | --- |
| M-01 — Fechar a evidência do piloto | Auditorias corrigiram falhas reais; o E2E motivou correção delimitada de metadata e verificou conversa/criação/abertura. O URL passou ao helper nativo, conservando `SAFE_URL`, com 3 testes/14 asserções e tipos engine/server sem erros. | Sem capacidade nova. Inspeção visual e registos finais pertencem ao coordenador; nenhum canário extra pedido por esta revisão. Falha repetida da mesma causa exige diagnóstico, sem abrir permissões. Rollback: conservar abertura pelo catálogo se o link falhar. | **adopt** no âmbito já autorizado. Aceita os fluxos sintéticos observados; Alan conserva aceitação humana. |
| M-02 — Template especializado quando o uso provar a necessidade | Só existe o coordenador base; a especificação prevê reutilizar método sem memória. Uma próxima evolução poderia acrescentar apenas o primeiro papel útil, com versão fixa e vínculo próprio por projeto. | Implica UI/configuração/testes de dois projetos e manutenção de versões; benefício ainda não medido. Menor check futuro: um pedido real que o coordenador base não satisfaça e repetição sintética em A/B sem herança de histórico. Sem experiência nesta revisão. | **defer**. Avaliação autorizada; implementação futura exige âmbito escolhido pelo utilizador. Alternativa atual: instruções e documentos aprovados no próprio projeto. |
| M-03 — Claude com paridade de contrato | A assinatura foi escolhida, mas o transporte não está validado. Reutilizar o contrato de destino/permissões/provas sem fingir compatibilidade de CLI. | Exige investigação da versão instalada, transporte, login humano e validação independente; custo desconhecido. Menor check futuro: demonstrar o contrato antes de habilitar uma conversa. Sem chamadas, instalação ou login novos nesta revisão. | **defer** até haver necessidade de Claude. A autorização de avaliar não habilita transporte nem gasto adicional. Manter indisponível é o rollback e a alternativa atual é Codex elegível. |

**M-04 — adopt: arranque reproduzível.** O PATH efémero herdado mudava o digest e recusava corretamente a prova antiga. A revisão adicional inspecionou a factory, o teste e o leitor: fixar o PATH Windows na factory partilhada, com CLI já resolvido, é o menor ajuste suficiente. O critério de fecho é uma nova prova única, o mesmo digest no daemon e a UI pronta. Não retirar PATH do digest, aceitar prova incompatível, acrescentar cache ou mudar permissões. É uma correção reversível no âmbito já autorizado; prova inconclusiva exige manter o modelo indisponível e diagnosticar, sem retries automáticos.

Não recomendo acrescentar mais capacidades nesta entrega. Quadro nativo, partilha, novos conectores, execução local e automações ampliam contratos e superfície de falha; só passam ao próximo lote por uma necessidade concreta. Não se propõe cache do hash, novo supervisor, pesquisa semântica, classificador aprendido ou benchmark de modelos sem um problema observado que os exija.

## Estado do fecho

**Fluxo sintético verificado; link direto corrigido por teste.** O coordenador comunicou reinício com PID 33188, menu Spaces e cartão Pronto para usar observados no browser. Às 17:31, a primeira conversa normal falhou com operação não suportada. O diagnóstico offline de REA encontrou `thread/settings/updated` e `turn/moderationMetadata` no contrato instalado e ausentes da allowlist do transporte. Os nomes foram observados, mas os payloads reais não foram preservados: o primeiro frame exato que causou a falha permanece desconhecido. Harness assumiu a correção/fixtures; não foi alterado o launch, o perfil ou a prova nativa, nem foram repetidos os canários de modelo.

O ajuste proporcional é reconhecer somente os eventos benignos demonstrados pelo contrato e pelas capturas, conservando a recusa de pedidos/ferramentas nativas. Ready prova elegibilidade, não a execução completa de uma conversa. Esta falha confirma por que o E2E era critério de fecho e não uma formalidade dispensável.

Verificação integrada comunicada nesta fronteira: **246 testes backend/1311 asserções**, **24 testes UI/130 asserções**, tipos de quatro pacotes, lint, boundaries, migrações e build sem erros. Depois, Harness comunicou a correção de metadata com **28 testes/108 verificações**, typecheck e Biome verdes; requests, ferramentas, permissões e métodos desconhecidos continuam recusados. REA confirmou o novo código no **PID 39568**, paragem anterior graciosa/saída 0 e saúde/DB OK no piloto e no oficial; recibo privado `.rheo/pilot-compat-restart.json`.

Às **17:52**, o coordenador observou no browser “Coordenador respondeu” e uma resposta real em português que descreve objetivos, factos/hipóteses, criação de projeto isolado e os limites do painel de metadados. Às **17:53**, o pedido explícito criou `Validação automática Spaces (teste)` em Profissional → Cliente exemplo (teste), com perfil base. A confirmação foi além da resposta do modelo: o coordenador abriu o catálogo, encontrou o novo card e abriu `/org/3962022a-69db-4245-b0b3-bd84c66fc516/c/b513dc3e-d503-40e8-9d8d-57608de003e2`. Observou o título/breadcrumb corretos, chat vazio, Conhecimento 0 e Fontes 0; o briefing do outro projeto não apareceu nesse novo projeto. É um fluxo sintético concreto, complementar aos testes negativos, não prova universal de ausência de contaminação.

Foi ainda observado um defeito de apresentação: o renderer permite URLs HTTP(S), e o URL relativo da ferramenta apareceu como Markdown literal. O coordenador usou `appPageLink` com o `PUBLIC_URL` próprio, conservando a validação `SAFE_URL`; teste RED→GREEN, 3 testes/14 asserções e tipos engine/server passaram. Não foi repetido um clique numa nova resposta de modelo com URL absoluto. Isso não invalida a criação/abertura pelo catálogo. Os resultados acima são evidência comunicada pelos responsáveis, não execução repetida pelo autor deste parecer.

Atualização operacional: após a interrupção, o PID 26288 expôs drift de ambiente e manteve o modelo bloqueado. O ajuste M-04 passou em 25 testes/106 asserções, tipos server e Biome; REA executou um único novo diagnóstico às 23:36:26, elevando o histórico a três turns. Houve 13/13 canários OS, duas operações nativas bloqueadas e zero efeitos observados. A prova nova e o probe do daemon PID 44740 às 23:38:14 coincidiram em `f3931e9a…fdc00b`; o coordenador observou Pronto para usar e guardou a captura final. Não foi repetido o E2E de criação, cujo código não mudou. O oficial em 4310 recusou conexão na última consulta e foi preservado; não se converte saúde histórica em disponibilidade corrente.

**Resumo para validar:** o piloto separado demonstrou conversa Codex real, criação interna e abertura de um projeto sintético sem herdar o briefing do anterior. Recomendo usar esse fluxo antes de ampliar o produto; o link direto foi corrigido e passou nos testes próprios. Claude, equipa ampliada, partilha e execução externa continuam capacidades posteriores; dados reais e aceitação humana não estão demonstrados por esta revisão.

Não foram repetidos testes, canários, login ou chamadas de modelo nesta frente. Risco remanescente: uma mudança no CLI/configuração/ambiente exige revalidação; uma entrega sintética não confirma prontidão operacional com clientes reais.
