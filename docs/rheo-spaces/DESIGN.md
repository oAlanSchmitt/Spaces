# Spaces — adaptação autorizada

Revisão de 16/11/2026: o utilizador autorizou conhecimento comum por Espaço e trabalho/imagens na conversa, com o rótulo Área. [ADR 0186](../adr/0186-spaces-shared-knowledge-and-local-work.md) e [plano da evolução](../superpowers/plans/2026-11-16-spaces-shared-work.md) definem o contrato atual. O registo abaixo conserva as decisões e limites do piloto inicial. A prova de leitura dessa fase não habilita o novo perfil de trabalho.

Data: 14/11/2026. Base: `071026d41f293d26cca480874cad5f66658d716c`.

O utilizador aprovou a análise e autorizou criar o fork, aplicar a separação de projetos e acrescentar criação interna de projetos por agentes. A especificação original é `Plano completo para personalizar o agentes.chat.md`, versão 1.0. Esta entrega começa pelo piloto protegido acordado; funcionalidades não validadas ficam desativadas, incluindo execução de comandos e publicação externa.

## Decisão revista após auditoria

Uma organização nativa representa cada projeto. Negócio e espaço são agrupadores de navegação numa única instalação e conta. O código atual permite várias organizações por proprietário; a descrição antiga de organização única não corresponde a uma restrição de `createOrganization`. Harness, Segurança e Ponytail confirmaram independentemente esta evidência.

Reutilizar esta fronteira limita memória, configuração, conversas e ferramentas pelo `orgId` nativo, reduzindo os pontos alterados no núcleo. Uma organização de controlo contém somente catálogo/metadados e o coordenador global. Não receberá documentos privados de outros projetos. O modelo não escolhe o proprietário nem recebe uma ferramenta administrativa geral.

Alternativas consideradas: organização única exigiria estender a autorização em praticamente toda a recuperação de contexto; configuração apenas por canais não satisfaz isolamento. Uma aplicação independente recriaria infraestrutura existente.

## Contratos

- Marca durável `organizations.rheoProtected`; mapping ausente ou erro de política nunca permite fallback para execução legada.
- Projetos recebem organizações, canais, agentes e sessões independentes. Criar um projeto não muda a sessão atual nem copia o histórico.
- Criação interna resolve a pessoa solicitante no servidor, exige destino explícito e usa chave idempotente. Coordenador global recebe somente metadados para esta função.
- Perfil protegido permite apenas modelo sem executor de computador e ferramentas internas Spaces verificadas por identidade não serializável. Rotinas, missões, browser, shell, MCPs arbitrários e publicação externa ficam desativados.
- Contexto protegido substitui a montagem legada. Memória automática, wiki e preferências globais não são injetadas. Contexto conservado pertence à conversa original e às fontes classificadas autorizadas.
- Recursos restritos não classificados permanecem indisponíveis; nenhuma ingestão automática de clientes reais.
- Arquivar impede novas execuções e ferramentas. Ler projetos arquivados continua possível ao proprietário.
- Aprovações antigas e APIs nativas não ampliam o perfil protegido.
- Aplicação e dados do fork usam identidade, diretório e porta separados da instalação oficial.

## Entrega e verificação

Primeira entrega: catálogo de negócios/espaços, criação/abertura/arquivamento de projetos, coordenador com ferramenta interna de criação, contexto isolado, memória/documentos mediados e recibo verificável. Testes determinísticos com clientes fictícios e provedor falso verificam fontes reais enviadas, chamadas diretas e falhas de autorização.

Uso com dados reais depende dos resultados de testes, backup/restauração e manutenção ensaiada. Compartilhamento de conhecimento entre projetos não será habilitado antes de existir autorização exata, proveniência e revogação verificadas. O utilizador escolheu exclusivamente a assinatura Codex/Claude. O transporte Codex utiliza um perfil de autenticação próprio, sem copiar credenciais existentes; não recorre a chaves de API nem ao executor nativo legado. A disponibilidade exige versão compatível, isolamento verificado e login humano normal. Claude permanece indisponível enquanto não houver transporte equivalente validado.

O nome público é **Spaces**, por instrução do utilizador. Os nomes internos de tabelas, ficheiros e a pasta do checkout conservam o prefixo histórico para evitar alterações de compatibilidade sem benefício.

## Instalação observada

Aplicação oficial 0.8.4 em `~/.agentes/app/current`; servidor reportado 0.1.1, PG18. Bundle instalado não foi equiparado a um commit de origem. Nenhum segredo foi exibido. Não reutilizar seu diretório como banco de desenvolvimento.
