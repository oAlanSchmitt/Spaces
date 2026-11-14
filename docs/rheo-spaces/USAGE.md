# Utilizar o Spaces

O piloto local abre em **http://localhost:4410**. A opção **Spaces** no menu reúne os negócios, espaços e projetos. A instalação oficial continua em separado; abrir o desktop original não substitui automaticamente a sua interface pelo fork.

## Organizar o trabalho

Use **Negócio → Espaço → Projeto**:

- Negócio: uma atividade, como Profissional ou Pessoal.
- Espaço: um cliente ou área contínua, como Cliente A ou Ideias.
- Projeto: um objetivo com entrega e contexto próprios, como Site institucional ou Validação de uma ideia.

Crie o negócio e o espaço pelos botões do catálogo. Depois crie o projeto com o perfil base. Cada projeto recebe a sua organização, conversa e coordenador; o histórico e o conhecimento de outro projeto não são copiados.

O perfil inicial é um coordenador. Os especialistas que participaram no desenvolvimento e na auditoria deste fork não são automaticamente nove agentes configurados dentro da aplicação.

## Pedir um projeto novo ao agente

Abra o **Coordenador global** pelo catálogo e indique o destino e o objetivo. Por exemplo:

> No negócio Profissional, no espaço Cliente A, cria o projeto Site institucional. O objetivo é preparar o briefing e a proposta de estrutura.

O coordenador consulta os destinos disponíveis e cria o projeto através da ferramenta interna. Recebe metadados do catálogo; não recebe documentos privados dos projetos. Um pedido repetido na mesma execução não cria outro projeto igual. A resposta fornece o local para abrir o projeto; a conversa de origem conserva o seu contexto.

Use o coordenador global para organizar iniciativas. Desenvolva o conteúdo do trabalho na conversa do projeto correspondente. A criação interna do piloto pertence ao coordenador global; os agentes de projeto mantêm o seu âmbito.

## Dar conhecimento ao projeto

Abra **Conhecimento** no projeto ou o botão correspondente no catálogo. Adicione um documento ou memória e escolha a visibilidade:

- **Só para mim** é o padrão na interface. O conteúdo fica fora do contexto dos agentes.
- **Equipe do projeto** torna o conteúdo aprovado disponível apenas aos agentes desse projeto.
- Uma memória proposta pelo agente aguarda revisão humana. Só depois de aprovada passa a ser recuperável.

As entradas mais recentes aparecem primeiro. **Carregar mais** permite consultar entradas anteriores. O agente pode ler um documento aprovado pelo identificador, mesmo fora da lista inicial. O contexto automático tem limites de tamanho; não envia todo o acervo a cada pedido.

**Fontes usadas** mostra os recibos das execuções recentes. Arquivar uma fonte impede a sua reutilização e a de derivados na montagem de contextos posteriores; uma resposta ainda por publicar é revalidada antes de ser guardada. O histórico já visível às pessoas mantém-se.

Os **Itens de ação** são registos no Conhecimento do projeto. Não são os cartões do quadro nativo **Tarefas** e não iniciam trabalho de código ou ações externas.

## IA e limites do piloto

Em **Codex por assinatura**, ligue a conta pela página oficial. A autenticação usa um perfil próprio deste fork e não copia a sessão da instalação original. Só **Pronto para usar** significa que a ligação e as verificações exigidas estão satisfeitas. Uma conta ligada com isolamento pendente ainda não habilita os agentes.

Não há fallback para uma chave de API. A compatibilidade está vinculada à versão, ao executável, à configuração e ao ambiente verificados. Alterações relevantes voltam a exigir validação. Claude ainda não tem transporte equivalente validado neste piloto.

O perfil protegido disponibiliza conversa, criação interna de projetos e ferramentas de conhecimento/itens de ação. Execução de programas, browser, conectores, rotinas automáticas e publicação externa continuam desativados. Esta fase não constitui um ambiente completo de desenvolvimento e implantação de software.

## Operar e recuperar

O arranque, encerramento e backup são próprios deste fork. Consulte [os comandos e os ensaios de recuperação](RUNTIME.md). Use sempre o mesmo diretório de dados do piloto. O backup é privado e não cifrado; a sessão Codex pode exigir um novo login normal após recuperação. Não utilize os dados da instalação oficial como pasta de ensaio.

Arquivar um projeto conserva os seus dados para consulta. Reabrir permite novos pedidos; não deve reiniciar automaticamente trabalho antigo.

## O que mudou

Agora existe um catálogo hierárquico visível, criação interna de projetos pelo coordenador global, separação de contexto por projeto, conhecimento classificado com revisão de memória e inspeção de fontes. O modelo por assinatura tem verificações próprias e não herda automaticamente ferramentas do computador.

Antes, o fluxo nativo organizava workspaces e canais sem esta camada de negócio/espaço/projeto nem estes contratos específicos de conhecimento e execução. As capacidades gerais do upstream que não foram verificadas para o perfil protegido não fazem parte desta entrega.
