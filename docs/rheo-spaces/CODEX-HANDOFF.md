# Projeto, pasta e continuidade no Codex

Atualização de 16/11/2026: este fluxo permanece como **Trabalhar aqui → Exportar briefing**, uma alternativa auxiliar. O percurso de desenvolvimento na conversa usa uma associação de execução separada, definida no [ADR 0186](../adr/0186-spaces-shared-knowledge-and-local-work.md) e no [guia atual](USAGE.md). A referência de pasta deste documento não concede nem revoga esse acesso. O registo seguinte descreve a entrega histórica do briefing.

Data: 15/11/2026. Âmbito autorizado: primeira opção escolhida pelo utilizador após o conselho.

## Resultado

Cada projeto conserva uma pasta opcional, o objetivo da próxima tarefa e critérios de entrega. Um diálogo **Continuar no Codex**, acessível pelo catálogo e pela conversa do projeto, guarda estas referências e prepara um briefing copiável. Usa componentes e tokens do agentes.chat.

A pasta é uma referência fornecida pela pessoa. Não é inspecionada, criada ou aberta pelo servidor e não concede acesso aos agentes. O briefing é texto determinístico, sem chamadas de modelo. Não há integração automática com o Codex desktop, execução, edição de ficheiros, instalação ou publicação.

## Contrato

- Acrescentar `folderPath` nullable, `handoffObjective` e `handoffCriteria` ao projeto por migração nova. Manter estas informações fora do catálogo disponibilizado aos agentes.
- Dono ativo do projeto e do painel pode ler/alterar a configuração. Outros projetos/utilizadores não recebem informação. Num projeto arquivado, GET permite consultar a referência e PUT recusa preparar novo trabalho.
- `GET /api/app/spaces/projects/{projectId}/handoff` devolve `{folderPath: string|null, objective: string, criteria: string}`.
- `PUT` no mesmo caminho recebe esse objeto estrito, guarda e devolve os mesmos campos mais `{briefing: string, entryIds: string[], omittedCount: number}`. Limites: caminho 2000 caracteres, objetivo e critérios 4000 cada. Caminho vazio remove o vínculo. Caminho preenchido tem de ser absoluto, sem caracteres de controlo, com sintaxe Windows ou POSIX. Não afirmar existência nem canonicalização no disco.
- Briefing inclui negócio/espaço/projeto, URL nativo da conversa, pasta como dado literal, objetivo, critérios e referências/conteúdo aprovado para a equipa deste projeto. Usar a recuperação existente que verifica aprovação, visibilidade e dependências revogadas. Conteúdo privado, proposto, arquivado ou de outro projeto fica excluído.
- Reutilizar a janela nativa de até 100 entradas aprovadas recentes e declarar esse limite no briefing. Limitar a secção de conhecimento a 12000 caracteres, com cortes/omissões explícitos e IDs só das entradas efetivamente incluídas. `omittedCount` conta apenas entradas dessa janela que não couberam no texto, não o acervo total. Texto de fontes é dado citado, não instrução de execução. Não produzir comandos de shell com o caminho.
- O briefing identifica-se como fotografia do contexto no momento da preparação. Copiar não inicia uma tarefa nem sincroniza alterações futuras.
- UI permite editar/remover caminho, guardar e preparar, ver/copiar o texto com feedback de sucesso/erro e seleção manual quando clipboard falha. Alterar campos invalida a prévia antiga. Sem novas dependências.

## Verificação

Testes de autorização entre donos/projetos, caminhos com espaços/UNC/relativos/controlo, remoção do vínculo, conteúdo permitido/excluído/revogado, limites e recibos do texto; testes DOM do fluxo e clipboard; tipos, lint, boundaries, migrações e build. Verificação visual no piloto com dados sintéticos, incluindo caminho comprido e largura estreita.

## Entrega verificada em 15/11/2026

- Testes integrados: 23 backend/266 asserções, 23 UI/195 asserções e 14 geometria/257 asserções, sem falhas. Tipos DB/engine/server/web, Biome de 15 ficheiros, fronteiras, migrações e builds web/server passaram.
- A verificação de geometria tinha uma falha anterior em Windows: separadores diferentes faziam duplicar CSS. O mesmo conteúdo de HEAD reproduziu 82 folhas e layer ausente; normalizado, resultou em 75 folhas e layer base. Uma linha normaliza os separadores antes do filtro. Não houve alteração de estilos globais ou baseline.
- Ponytail reviu a alteração integrada sem achados a exigir correção. REA confirmou ausência de acesso à pasta, chamada de modelo ou alteração do executor e identificou o caso de controlos antes de normalizar vazio, corrigido com RED→GREEN. Maquiavel recomendou concluir esta opção sem ampliar funcionalidades.
- Piloto: paragem limpa do PID 44740, backup frio privado verificado de 2035 ficheiros e reinício PID 3964, ready às 00:32:01 UTC. Recibo privado `.rheo/handoff-maintenance.json`. O probe normal do daemon passou 13/13 com o mesmo digest de configuração Codex `f3931e9a…fdc00b`, e a interface mostrou Pronto para usar. Nenhum novo turn diagnóstico ou chamada de modelo nesta entrega.
- Browser real: associação/objetivo/critérios guardados e recuperados ao reabrir. Outro projeto permaneceu vazio. Briefing com a fonte aprovada sintética; clipboard exatamente igual à prévia de 1606 caracteres. Entradas pelo catálogo e pela conversa confirmadas.
- Layout observado a 1280, 390 e 320 píxeis, sem transbordo horizontal ou ações cortadas. Capturas privadas antes/depois em `.rheo/screenshots/handoff-*-1280.jpg` e `handoff-*-390.jpg`; captura final `Spaces-codex-handoff.jpg`. A largura temporária foi reposta. As skills break-ui e Impeccable não estavam disponíveis; testes e inspeção visual foram feitos sem alegar a sua execução.

O ensaio usou exclusivamente dados sintéticos. Não abriu o Codex automaticamente nem verificou a existência da pasta. Uma cópia continua a ser uma fotografia, não uma ligação sincronizada.

**Resumo para validar:** referências de pasta e contexto portátil para continuar no Codex implementados e verificados no piloto. A aplicação continua sem acesso à pasta ou executor de código neste perfil.
