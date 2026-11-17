# Utilizar o Spaces

Com o servidor iniciado, o piloto local abre em **http://localhost:4410**. A opção **Spaces** no menu reúne áreas, espaços e projetos. A instalação oficial continua em separado. Abrir o desktop original não substitui automaticamente a sua interface pelo fork.

## Abrir no Windows

Dê dois cliques em **Spaces.exe**, na Área de Trabalho. O lançador verifica o pacote e abre esta versão no navegador padrão. Se o servidor já estiver pronto, reutiliza-o. Entre com a sua conta local do piloto caso esse navegador ainda não tenha sessão.

Este executável usa uma cópia congelada do servidor e da interface. Editar o checkout não atualiza a versão entregue. Os dados e o login Codex continuam nos diretórios privados existentes. Conserve a pasta `rheo-spaces`: o executável da Área de Trabalho depende do pacote guardado em `.rheo/releases` e do PowerShell/Codex validados deste PC.

Fechar o navegador deixa o servidor disponível. Para o encerrar de forma limpa, execute `Spaces.exe --stop` no terminal. Não copie apenas o executável para outro computador; esta entrega está associada à instalação local.

## Organizar o trabalho

Use **Área → Espaço → Projeto**:

- Área: uma grande divisão, como Profissional ou Pessoal.
- Espaço: um contexto contínuo, como Cliente A ou Ideias, com conhecimento comum para os seus projetos.
- Projeto: uma entrega, como Site institucional ou Campanha de novembro, com conversa, contexto específico e pasta próprios.

Crie a área e o espaço pelos botões do catálogo. Depois crie o projeto com o perfil base. Cada projeto recebe a sua organização, conversa e coordenador. As fontes aprovadas do seu Espaço são consultadas sem criar cópias. A conversa e o conhecimento específico de outro projeto permanecem separados.

O perfil inicial é um coordenador. Os especialistas que participaram no desenvolvimento e na auditoria deste fork não são automaticamente nove agentes configurados dentro da aplicação.

## Pedir um projeto novo ao agente

Abra o **Coordenador global** pelo catálogo e indique o destino e o objetivo. Por exemplo:

> Na área Profissional, no espaço Cliente A, cria o projeto Site institucional. O objetivo é desenvolver o site e verificar o resultado.

O coordenador consulta os destinos disponíveis e cria o projeto através da ferramenta interna. Recebe metadados do catálogo; não recebe documentos privados dos projetos. Um pedido repetido na mesma execução não cria outro projeto igual. A resposta fornece o local para abrir o projeto; a conversa de origem conserva o seu contexto.

Use o coordenador global para organizar iniciativas. Desenvolva o conteúdo do trabalho na conversa do projeto correspondente. A criação interna do piloto pertence ao coordenador global; os agentes de projeto mantêm o seu âmbito.

## Dar conhecimento ao espaço e ao projeto

No cartão do Espaço, abra **Conhecimento compartilhado**. Coloque aqui a identidade visual, regras, decisões e documentos que devem servir todos os seus projetos. Escolha **Todos os projetos do espaço** para disponibilizar o conteúdo aprovado. **Só para mim** conserva o conteúdo privado. Também pode editar ou arquivar as fontes comuns neste painel.

Não é preciso copiar a mesma identidade para cada projeto. Um projeto novo no mesmo Espaço já pode consultar a base comum. Outro Espaço não a herda. O conhecimento existente antes desta evolução continua no projeto original, sem promoção automática.

Abra **Conhecimento** no projeto ou o botão correspondente no catálogo. Adicione um documento ou memória e escolha a visibilidade:

- **Só para mim** é o padrão na interface. O conteúdo fica fora do contexto dos agentes.
- **Equipe do projeto** torna o conteúdo aprovado disponível apenas aos agentes desse projeto.
- Uma memória proposta pelo agente aguarda revisão humana. Só depois de aprovada passa a ser recuperável.

As entradas mais recentes aparecem primeiro. **Carregar mais** permite consultar entradas anteriores. O agente pode ler um documento aprovado pelo identificador, mesmo fora da lista inicial. O contexto automático tem limites de tamanho; não envia todo o acervo a cada pedido.

Entradas **Do espaço** mostram a sua revisão e são herdadas. Altere-as no painel do Espaço. Não representam notas privadas do projeto vizinho.

**Fontes usadas** mostra os recibos das execuções recentes, incluindo identificadores e revisões. Editar, privatizar ou arquivar uma fonte invalida os contextos antigos e os seus derivados. Uma resposta ainda por publicar é revalidada antes de ser guardada. O histórico já visível às pessoas mantém-se. Isto não desfaz alterações já escritas em ficheiros.

Os **Itens de ação** são registos no Conhecimento do projeto. Não são os cartões do quadro nativo **Tarefas** e não iniciam trabalho de código ou ações externas.

## Desenvolver na conversa

No projeto ou no catálogo, abra **Trabalhar aqui**. Indique uma pasta existente deste computador e associe-a explicitamente. Esta associação permite executar o trabalho pedido e escrever nessa pasta. Não escolha a pasta do servidor, dados, autenticação ou uma raiz já associada a outro projeto.

O estado do trabalho é separado do cartão geral Codex. **Pendente** ou **Bloqueado** não permitem execução. Quando estiver **Pronto**, volte à conversa do projeto e peça uma entrega concreta, por exemplo:

> Cria uma página inicial na pasta deste projeto, usando a identidade aprovada do espaço. Executa as verificações locais disponíveis e entrega os ficheiros com o resultado dos testes.

> Gera uma imagem de capa para este projeto, usando as cores e o público definidos no espaço. Entrega a imagem nesta conversa.

O Coordenador chama o executor Codex existente nos bastidores. Não é necessário abrir a aplicação Codex nem copiar um briefing. Os resultados e ficheiros entregues aparecem na conversa e no Drive do projeto. Um resumo deve distinguir alterações efetuadas, testes observados e limitações.

Imagens usam a capacidade nativa da assinatura. Disponibilidade e quota são verificadas pela execução, sem inventar um fornecedor alternativo nem usar uma chave paga. Uma falha deve aparecer como falha, sem um cartão que finja uma imagem gerada.

Pode parar o trabalho pela conversa e remover a associação em **Trabalhar aqui**. A revogação interrompe o turno ativo e impede novas entregas por esse vínculo. Ficheiros já alterados permanecem na pasta. Depois de uma interrupção ambígua, confira o estado antes de pedir continuação. O servidor não repete automaticamente o mesmo turno sem um resultado conclusivo.

## Exportar um briefing opcional

Em **Trabalhar aqui → Exportar briefing**, permanece disponível o fluxo auxiliar **Continuar no Codex**. Indique uma referência de pasta, objetivo e critérios, prepare a prévia e copie para outro ambiente quando isso for útil.

O caminho deste briefing é apenas uma referência e não concede acesso. É separado da associação de execução em **Trabalhar aqui**. Limpar a referência no briefing não revoga a associação de trabalho.

O briefing inclui o destino, objetivo, critérios e conhecimento aprovado do Espaço e do projeto, com origem e revisão. Conteúdo **Só para mim**, memórias propostas e fontes arquivadas ou revogadas não entram nessa recuperação. A janela contém até 100 entradas recentes e a secção de conhecimento tem orçamento de 12000 caracteres. Cortes e omissões são indicados no texto. Não é uma exportação integral do acervo nem do histórico da conversa.

O texto é uma fotografia do contexto na preparação. Se fontes ou instruções mudarem, prepare-o novamente. Uma cópia já feita não é atualizada nem revogada à distância. Se a cópia automática falhar, selecione o texto da prévia e copie manualmente.

Projetos arquivados ficam disponíveis para consulta e não iniciam novo trabalho.

## IA e limites do piloto

Em **Codex por assinatura**, ligue a conta pela página oficial. A autenticação usa um perfil próprio deste fork e não copia a sessão da instalação original. Só **Pronto para usar** significa que a ligação e as verificações exigidas estão satisfeitas. Uma conta ligada com isolamento pendente ainda não habilita os agentes.

Não há fallback para uma chave de API. A compatibilidade está vinculada à versão, ao executável, à configuração e ao ambiente verificados. Alterações relevantes voltam a exigir validação. Claude ainda não tem transporte equivalente validado neste piloto.

O perfil protegido disponibiliza conversa, criação interna de projetos e ferramentas de conhecimento/itens de ação. O percurso de trabalho acrescenta execução local e imagens somente quando a associação e o perfil estão elegíveis. Browser, conectores arbitrários, instalação de dependências, rotinas automáticas e publicação externa continuam fora deste percurso.

## Operar e recuperar

O arranque, encerramento e backup são próprios deste fork. Consulte [os comandos e os ensaios de recuperação](RUNTIME.md). Use sempre o mesmo diretório de dados do piloto. O backup é privado e não cifrado; a sessão Codex pode exigir um novo login normal após recuperação. Não utilize os dados da instalação oficial como pasta de ensaio.

Arquivar um projeto conserva os seus dados para consulta. Reabrir permite novos pedidos; não deve reiniciar automaticamente trabalho antigo.

## O que mudou

O catálogo usa Área, Espaço e Projeto. O Espaço fornece conhecimento comum canónico e os projetos conservam o contexto específico. O trabalho pode ser solicitado na própria conversa, com associação explícita da pasta, executor Codex reutilizado e ficheiros entregues no projeto. O modelo por assinatura tem verificações próprias e não herda automaticamente ferramentas irrestritas do computador.

Antes desta evolução, o Espaço era apenas navegação, o conhecimento ficava isolado em cada projeto e a pasta servia para preparar um briefing externo. Os estados e ensaios efetivamente observados estão no registo de execução. Disponibilidade em código, teste sintético e aceitação humana são verificações diferentes.
