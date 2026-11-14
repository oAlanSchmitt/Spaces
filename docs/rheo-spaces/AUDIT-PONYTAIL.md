# Auditoria Ponytail — Spaces

Data: 14/11/2026. Base upstream: `071026d41f293d26cca480874cad5f66658d716c`; branch de trabalho `feat/spaces`. Este relatório cobre a implementação Spaces e os seus chamadores, incluindo código novo ainda não commitado. A validação final do processo reiniciado e de uma conversa normal pertence ao coordenador e deve ser registada como evidência adicional.

## O que este projeto faz

O Spaces organiza negócios, espaços e projetos numa instalação local do agentes.chat. Cada projeto protegido tem organização, contexto, conhecimento revisto e coordenador próprios; o coordenador global pode criar novos projetos usando apenas metadados do catálogo. O transporte Codex usa a assinatura ligada manualmente e mantém ferramentas de computador fora do perfil protegido.

Carga assumida: um proprietário neste PC Windows, poucos projetos, aproximadamente dez como cenário de utilização pessoal. Não foi assumido serviço público, múltiplas réplicas ou milhares de chamadas simultâneas.

## Método e alcance

Foi aplicada a skill pessoal `ponytail-specialist` e o contrato `ponytail-audit`, na versão **5.3.3**, confirmada no manifesto Codex e no `package.json` do plugin instalado. O nível `full` foi anunciado pela sessão. Ler estas instruções não comprova execução dos hooks; não foram alterados modo persistente, configuração, confiança ou hooks.

Foram seguidos os fluxos de bootstrap/criação/arquivo, sessão e APIs, montagem do contexto, ferramentas, recibos e revogação, filas e caixas de entrada, gateway de modelos, cliente Codex, prova nativa, primeiro acesso, catálogo e conhecimento na UI. Foram revistos os pontos conectados de `executor.ts`, `messages.ts`, `run-inbox.ts`, `jobs.ts`, pesquisa/aprendizagem, schema/migrações e configuração de build. Também foram lidos os comandos de operação e recuperação; a auditoria operacional independente está em [AUDIT-REA.md](AUDIT-REA.md).

O estado atual reutiliza a transação, a organização, as permissões, a fila, o cancelamento e os componentes visuais nativos. Os manifests das aplicações e o lockfile não acrescentaram dependências. As tabelas e os ficheiros com prefixo histórico foram conservados para compatibilidade; o nome de produto visível é Spaces.

## Achados prioritários e correções

### 1. Entradas novas desapareciam ao ultrapassar os limites da lista — corrigido

**Prioridade:** P2. `rheo-knowledge.ts:listRheoEntries/listRheoRunEntries` e `rheo-tools.ts:entriesFor`.

**O que é:** a pessoa consulta conhecimento na interface e o agente lista/lê fontes aprovadas.

**Problema observado:** com 201 documentos sintéticos, a UI recebia apenas os 200 mais antigos e os agentes os 100 mais antigos. O documento 201 estava gravado, mas desaparecia de ambas as respostas. A leitura de um documento por ID filtrava a lista já limitada, podendo responder “não encontrado” para uma fonte válida.

**Correção:** paginação por cursor na API/UI, com 50 entradas por página; ordenação das fontes recentes primeiro e filtro SQL por ID antes do limite. Mantiveram-se os filtros de organização, aprovação, visibilidade e proveniência. O coordenador acrescentou testes com 202 entradas, cinco páginas sem duplicação, novo conteúdo entre páginas, cursor inválido/alheio e leitura exata de um ID antigo. A inspeção do código confirmou esse contrato.

**Se fosse adiado:** conteúdo guardado continuaria inacessível e as pessoas poderiam criar duplicados para tentar recuperá-lo.

### 2. Duplicados simples apareciam como falha interna — corrigido

**Prioridade:** P2. `rheo-spaces.ts:createRheoBusiness/createRheoSpace`.

**O que é:** nomes de negócios e espaços são únicos sem distinguir maiúsculas de minúsculas.

**Problema observado:** `ClienteX` seguido de `clientex`, ou `ProjetoX` seguido de `projetox`, alcançava o índice único e gerava `DrizzleQueryError`, código PostgreSQL `23505`. Essa exceção não era um erro de domínio mapeado pela API e tornava-se uma resposta 500.

**Correção:** comparar `lower(nome)` no SQL, exatamente como o índice, e devolver `ValidationError` antes de inserir. A verificação fica dentro do lock/transação do proprietário. Testes cobrem nomes iguais e variantes de caixa, incluindo `Construção`.

**Verificação:** RED real antes do patch; GREEN no lote de domínio/assinatura: 16 testes, 81 asserções. A suíte integrada posterior também passou.

**Se fosse adiado:** uma entrada normal do utilizador continuaria a produzir erro de servidor e ruído de diagnóstico.

### 3. Cada verificação carregava o executável inteiro em memória — corrigido

**Prioridade:** P2 para o objetivo de utilização leve. `spaces-codex.ts:sha256File/inspect`.

**O que é:** o transporte volta a conferir a identidade do CLI nas consultas de estado e nos limites da execução. O executável instalado mede **373 698 352 bytes**.

**Problema observado:** `createHash(...).update(await readFile(command))` materializava esse ficheiro inteiro em cada verificação. A UI ligada e ainda pendente podia verificar a cada três segundos; chamadas simultâneas podiam sobrepor buffers grandes.

**Correção:** SHA-256 por `createReadStream`, em blocos de 1 MiB. O ficheiro inteiro continua a ser validado; não se introduziu cache nem se retirou uma fronteira de segurança. O helper é exportado para evitar duplicar a leitura integral nos diagnósticos.

| Ensaio isolado do algoritmo | Tempo de uma leitura | RSS antes → depois | Resultado |
| --- | ---: | ---: | --- |
| Buffer integral anterior | 233 ms | 127 → 501 MB | SHA-256 `83f5c2dd…` |
| Stream de 1 MiB | 148 ms | 127 → 162 MB | SHA-256 idêntico |

É uma amostra local do algoritmo, com cache do sistema já aquecida; não é uma economia global de RAM, CPU, energia ou preço do produto. A medição adicional através do módulo completo também devolveu o mesmo hash, mas a inicialização dos restantes módulos afetou o RSS e impede atribuir todo o valor ao helper. O teste funcional usa mais de dois blocos, altera o último byte, confere o hash novo e verifica erro para ficheiro ausente.

**Se fosse adiado:** manter-se-iam buffers de centenas de MB em verificações que não precisam deles.

### 4. Arquivar podia deixar trabalho preso ou permitir o seu regresso — corrigido

**Prioridade:** P2. `rheo-spaces.ts:setRheoProjectState/cancelRheoRun`, `rheo-jobs.ts`, `run-inbox.ts`, `rheo-policy.ts` e o ponto de escrita em `messages.ts`.

**O que é:** arquivar conserva o projeto para consulta, encerra o trabalho e permite novos pedidos depois de reabrir.

**Problema observado:** um pedido em fila continuava `queued` depois de arquivar, consumir os jobs e reabrir. O gate tinha consumido o job sem terminalizar a execução. Foi ainda reproduzido o caso de uma caixa de entrada já retirada da DB: arquivar/reabrir entre a retirada e o encaminhamento criava outra execução do pedido antigo. O sweeper nativo é chamado pelos workers fora do wrapper de jobs.

**Correção:** capturar as execuções abertas e caixas pendentes na transação de arquivo e cancelá-las depois do commit com `stopRun`, que já fecha pedidos/aprovações, regista o cancelamento e aborta a execução. O gate também encerra um job de execução tardio, após validar UUID e organização persistida; jobs desconhecidos continuam sem leitura do payload. As caixas derivadas são esvaziadas, preservando as mensagens originais.

Uma ação de arquivo no audit log existente é a marca durável. Usa `clock_timestamp()` depois de adquirir o lock do workspace, pois `now()` representaria o início da transação. O encaminhamento protege o estado com `FOR SHARE` e compara a criação da execução com a marca no próprio SQL. Isso impede ressuscitar um pedido antigo mesmo depois da reabertura. A reabertura recusa a janela em que o cancelamento anterior ainda não terminou. O coordenador também passou a comparar a identidade da marca antes e depois da preparação da mensagem.

Não se aguardam locks de execução mantendo o lock exclusivo do workspace durante o cancelamento. Não foram criados campos, tabelas ou um novo sistema de filas para esta regra.

**Verificação:** REDs reais dos casos; GREEN de cancelamento, aborto local, projeto alheio inalterado, job tardio com ID estrangeiro, job desconhecido sem leitura, caixa terminal pendente, IDs já retirados, janela de reabertura e pedido novo após reabrir. A suíte de entrega legada também passou. As janelas foram controladas em fixtures PGlite; não se fez ensaio de deadlock em PostgreSQL com duas conexões.

**Se fosse adiado:** a aplicação poderia mostrar trabalho permanente ou executar uma pergunta antiga depois de o utilizador acreditar que a tinha encerrado.

### 5. “Tarefa criada” sugeria um cartão que não existia no quadro — corrigido na apresentação

**Prioridade:** P2 de utilização. `rheo-tools.ts`, dicionários e [USAGE.md](USAGE.md).

**O que é:** a ferramenta protegida guarda um registo `kind=task` no conhecimento; o menu nativo Tarefas usa `issues`.

**Problema:** pedir ao coordenador uma tarefa e procurar o resultado no quadro nativo mostrava duas estruturas diferentes sem explicar o destino.

**Correção mínima acordada:** chamar-lhes **Itens de ação**, indicar explicitamente o Conhecimento como destino e documentar a separação. Não foi alargado o perfil de ferramentas nem foi criada uma sincronização entre duas fontes de dados. Integração de um quadro de execução fica como capacidade adicional, não como funcionalidade já entregue.

**Se fosse adiado:** a pessoa poderia interpretar um registo existente como tarefa perdida.

### 6. Recibos podiam incluir fontes removidas pelo corte da resposta — corrigido

**Prioridade:** P2. `rheo-tools.ts:entriesFor` e orçamento de `rheo-context.ts`.

**O que é:** os recibos sustentam o inspector e a revogação transitiva das fontes disponibilizadas ao modelo.

**Problema observado:** três documentos de 30 mil caracteres produziram 40 097 caracteres de resposta encapsulada; o recibo continha três IDs, mas só dois IDs estavam presentes no texto efetivamente devolvido. O recibo era gravado antes de `untrustedBlock` truncar a resposta. Na montagem inicial, somar apenas o tamanho dos corpos também pode deixar títulos/IDs ultrapassarem o orçamento final.

**Correção aplicada:** `rheo-entry-payload.ts` monta o JSON completo antes do recibo e é reutilizado pelo contexto inicial e pelas ferramentas. Metadados e escapes entram no orçamento; o primeiro documento demasiado grande recebe corte explícito, e entradas omitidas não entram no recibo. A neutralização de conteúdo ocorre nos campos antes da codificação JSON.

**Verificação:** RED→GREEN formal em `rheo-context.test.ts` e `rheo-tools.test.ts`: 100 documentos com metadados grandes, três documentos de 30 mil caracteres, documento com aspas e barras de 40 mil caracteres, JSON válido e revogação de fonte omitida sem invalidar a resposta. Lote integrado de contexto/conhecimento/ferramentas: **14 testes passaram, 54 asserções, zero falhas**, sem chamada de modelo.

**Se fosse adiado:** o inspector poderia atribuir uma fonte que não foi enviada; revogá-la poderia impedir a publicação de uma resposta sem relação efetiva com essa fonte.

## Contraponto e evidência integrada

REA reviu a distinção entre ganho local do hash e peso do produto completo, e recebeu os contraexemplos de filas/arquivo. No sentido inverso, foi dado contraponto ao seu achado de restauro parcial: reutilizar o guard existente e escrever o hold antes do payload é suficiente para o âmbito, sem introduzir outro supervisor ou sistema de recuperação. Os defeitos de restauro e da prova nativa estão detalhados no relatório REA e não são recontados como descobertas desta auditoria.

Verificação direta desta frente, depois das correções: **50 testes passaram, 207 asserções, zero falhas**, abrangendo domínio Spaces, jobs protegidos, entrega legada e serviço Codex; **typecheck engine/server passou**, Biome dos ficheiros alterados sem erros e `git diff HEAD --check` sem problemas. Avisos prévios de non-null assertions em fixtures não foram transformados em uma refatoração sem relação com os defeitos. Os logs e as reproduções locais ficam em `.rheo/ponytail-*`, fora do Git.

Os resultados mais amplos de UI, build, API, migrações e verificações do coordenador são evidências separadas, conservadas no registo de entrega. Parecer de auditor, testes e aceitação da interface não são equivalentes.

## Simplicidade e limites

- Não se acrescentaram dependências de aplicação. SHA, paginação, cancelamento e guardas usam biblioteca padrão ou mecanismos já existentes.
- Não há ganho honesto de linhas a anunciar: corrigir as falhas exigiu validações e testes. Um diff menor que reabra o executor nativo ou retire a revogação não cumpre o contrato.
- As leituras frescas de política adicionam seis/sete consultas nos percursos legados medidos; os limites de regressão foram alterados de propósito. Não se retirou essa proteção para melhorar um contador. A carga remota e a latência sob concorrência não foram medidas.
- O grafo de proveniência ainda valida os metadados do projeto em memória. O comentário `shortcut:` explicita o limite e o gatilho para consultas incrementais; não houve evidência de que a carga pessoal atual o ultrapasse. Não foram carregados corpos de outros projetos para o otimizar.
- O transporte continua a confiar no CLI fixado e na configuração verificada. Dois canários diagnósticos, um inconclusivo e outro objetivo, não demonstram segurança universal ou retenção zero pelo fornecedor.
- O perfil inicial é um coordenador, não nove especialistas internos já configurados. Criação interna pertence ao coordenador global. Programas, browser, conectores, rotinas e publicação continuam fora do piloto protegido.

**Veredito:** as correções verificadas resolvem os seis defeitos reproduzidos, incluindo os recibos e o orçamento dos dois chamadores. O processo reiniciado e a conversa normal são verificados separadamente no registo integrado de entrega.

**Não verificado:** toda a base upstream sem relação com Spaces, carga sustentada, PostgreSQL com duas conexões, consumo energético, dados reais, migração da instalação oficial, recuperação após perda do disco e aceitação humana global da interface. Não foram executados login ou chamadas reais de modelo por esta frente.
