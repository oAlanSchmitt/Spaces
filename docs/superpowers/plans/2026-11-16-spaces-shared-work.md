# Spaces: conhecimento comum e trabalho na conversa

Revisão r1, 16/11/2026. Base `9e4b5bf4ffbd3afe4316c1e7cb8d7600497a9a0a`.
Autoridade: pedido explícito do utilizador para implementar a evolução debatida com Maquiavel, reutilizando o agentes.chat e o seu Design System.

## Resultado contratado

- Hierarquia visível Área → Espaço → Projeto, conservando IDs, dados e compatibilidade interna.
- Uma fonte comum canónica por Espaço, com aprovação, proveniência, revisão e revogação. Projetos herdam apenas fontes autorizadas do seu Espaço e conservam conteúdo privado próprio.
- Desenvolvimento e imagens a partir da conversa do projeto, com pasta explicitamente associada, assinatura Codex existente, resultados persistentes na conversa e cancelamento. Briefing externo passa a alternativa.
- Reutilizar execução, eventos, artefactos e componentes existentes. Sem nova API paga, motor paralelo, dependências ou migração indiscriminada de organizações.

## Lotes e responsabilidade

1. Curadoria: schema/migração nova de conhecimento comum, recuperação/contexto, recibos por revisão, autorização/revogação e APIs. Provar A/B no mesmo Espaço e C noutro, com notas privadas, propostas e publicação em curso.
2. Harness: fechar a menor rota nativa completa de trabalho, ligar projeto/pasta/conta/sessão/perfil e adaptar ferramentas/política/executor. Provar código, comando/teste, eventos de imagem, artefactos, erro, cancelamento e fronteira de pasta.
3. Coordenador: UI reutilizando Conhecimento e configuração de projeto, terminologia Área, chamadas API e traduções. Manter conteúdo carregado sob pedido, origem visível e estados de prontidão separados.
4. REA independente: conferir CLI/binário/perfil instalados e propor ensaio sintético finito. A prova antiga de leitura não autoriza escrita ou imagens. Nunca copiar tokens, usar os dados da instalação oficial ou promover hipótese a capacidade observada.
5. Integração: verificações proporcionais, backup antes de migrar o piloto, ensaio sintético e inspeção visual 1280/390/320. Auditoria independente Ponytail + REA, correções e parecer Maquiavel sobre o resultado.

## Invariantes

- Fontes existentes continuam locais. Nenhuma promoção silenciosa para o Espaço.
- Catálogo global contém metadados, nunca corpos de conhecimento ou caminhos de trabalho de outros projetos.
- Conta e pasta são resolvidas pelo servidor para o projeto autorizado. Nunca escolher o primeiro checkout disponível.
- Ausência de conta, perfil compatível, pasta ou capacidade de imagem produz estado/erro explícito, sem fallback para API ou executor irrestrito.
- Execução local e criação de artefactos não autorizam publicação, instalação ou envio externo.
- Migrações comprometidas são imutáveis. Dados e login privados em `.rheo/` continuam excluídos do Git.

## Verificação e limites

Testes determinísticos verificam autorização, fronteiras, revisões e eventos. Runtime confirma instalação/conta/perfil apenas nos ensaios observados. UI confirma opções e estados visíveis, sem equivaler a aceitação humana ou piloto de cliente real. Experiência de modelo será limitada antes de iniciar, com resultados e falhas registados sem segredos.

Estado inicial: implementação em curso. Contrato final de execução e respetivos pré-requisitos serão registados antes de habilitar o perfil.

## Revisão r2: integração e recuperação

O Harness confirmou que ativar o brain nativo inteiro exigiria novos vínculos de máquina/conta por organização. Adotada a ferramenta interna `rheo_work`, reutilizando `CodexAppServers`, eventos, cancelamento, registo de utilização e artefactos. A sessão nativa é nova por recibo, evitando herdar contexto oculto após revogar uma fonte. A continuidade está na conversa autorizada e nos ficheiros.

A revisão independente Ponytail identificou a sessão antiga e a guarda de imagem por junction. O coordenador identificou caminhos absolutos/artefactos fora da raiz, hashing repetido no timer e ausência de conhecimento canónico no executor. As correções pertencem ao Harness e exigem testes antes de aceitação.

Maquiavel identificou a recuperação após prova negativa: a mesma pasta deve permitir nova verificação, conservar o motivo e permitir fechar o diálogo sem fingir cancelar o PUT já autorizado. A UI foi ajustada com teste RED→GREEN. A verificação explícita da associação não inicia um modelo. GET apenas consulta estado.

Limite do ensaio integrado: duas tarefas sintéticas (código/teste e imagem), cada execução nativa com timeout de cinco minutos. Até três chamadas JSON do Coordenador por tarefa são admitidas para encaminhamento e resumo, além do turno nativo. Não repetir uma mesma falha mais de duas vezes sem diagnóstico e revisão do caminho. São limites de ensaio desta entrega, não preços ou quotas prometidos ao utilizador. Sem API paga ou envio de dados reais.

Backup anterior às migrações: cópia privada verificada em 16/11/2026 às 12:38:50 UTC, 2039 ficheiros. A pasta é registada no recibo privado e permanece fora do Git. Nenhuma migração do piloto foi iniciada nesta fronteira.

## Revisão r3: ambiente real do modelo

O piloto iniciou com PID 41424 às 12:56:16 UTC, após o backup. Na UI real, a fonte comum apareceu no projeto vizinho e não no projeto de outro Espaço. A associação sintética ficou pronta. O primeiro pedido de código pela conversa falhou antes de criar ficheiros: `No usable execution environment is available`. O Coordenador relatou a falha sem inventar testes ou anexos.

REA identificou no schema instalado que `environments: []` desativa o acesso aos ambientes no thread e no turno. Um thread sem modelo confirmou o ambiente `local` pronto, com raiz exata, perfil nomeado e rede negada. Os canários de `command/exec` não cobriam essa seleção, pelo que não equivaliam a execução nativa completa. O piloto foi encerrado graciosamente antes da correção.

Decisão: uma função partilhada seleciona explicitamente o ambiente local observado e a raiz autorizada nos pedidos do runner/probe. O fingerprint inclui esse contrato e invalida a prova anterior. Repetir os controlos de confinamento antes do novo ensaio. O transporte fechado anterior permanece inalterado.

A evidência concreta justifica um turno nativo adicional: limite revisto de três turnos nativos no total (primeira falha de compatibilidade, repetição de código após corrigir o contrato e imagem). Até três chamadas JSON do Coordenador por pedido, sem retries automáticos. Não ampliar limites por mera demora ou ausência de resultado.

## Fecho r4

Os três ensaios nativos terminaram: primeiro bloqueado por compatibilidade, segundo entregou código e três testes aprovados, terceiro gerou/entregou PNG nativo. O recibo privado conserva ficheiros, hashes e distinção entre observação real e correções verificadas por testes. [RUNTIME.md](../../rheo-spaces/RUNTIME.md) contém a cronologia e os limites.

Ponytail e REA identificaram e sustentaram correções de fronteiras, sessão, ambiente, cancelamento, apresentação e escrita exclusiva da imagem. A revisão Maquiavel não encontrou outra funcionalidade necessária para este âmbito. O reinício final com PID 13408 confirmou persistência de conhecimento, associação e quatro artefactos. Estado: implementação e ensaio sintético concluídos; aceitação humana e uso num projeto real continuam distintos.

**Resumo para validar:** adicionar conhecimento comum por Espaço e trabalho na conversa do projeto, trocar o rótulo Negócio por Área e conservar dados/design existentes. O resultado depende de compatibilidade e validação da execução/imagens da assinatura instalada, sem ampliar permissões por inferência.
