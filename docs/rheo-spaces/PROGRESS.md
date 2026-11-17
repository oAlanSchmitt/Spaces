# Execução — Spaces

## Estado atual — 17/11/2026

- Auditoria final Ponytail/REA: corrigidas exportação por hardlink, licenças npm no Windows e resolução da raiz privada no bundle; verificação de integridade otimizada. [Relatório final](AUDIT-FINAL-DESKTOP.md).
- Executável entregue: `C:/Users/alan-/Desktop/Spaces.exe`; release congelada `spaces-0b2e2f4b2661`, publicada no fork. Dados/login preservados, backup frio verificado. Não mover nem apagar a pasta do fork.
- Arranque normal observado em 21,09 s; integridade em 1,42 s; segunda abertura reutilizou PID 27868. Health/DB prontos, interface autenticada confirmou catálogo e pasta pronta. Nenhuma chamada de modelo nesta auditoria.

## Entrega da evolução — 16/11/2026

- Evolução autorizada e implementada: Área → Espaço → Projeto, base comum canónica por Espaço, contexto específico do projeto e trabalho/imagens na própria conversa.
- Reutilização do `CodexAppServers`, artefactos e Design System existentes, sem novas dependências de aplicação. Associação explícita da pasta e execução condicionada ao perfil local verificado. Briefing mantido como alternativa auxiliar.
- Migrações aditivas 0275/0276, com snapshots novos e anteriores imutáveis. Backup privado verificado antes de migrar.
- Conhecimento comum observado em dois projetos do mesmo Espaço e ausente num terceiro de outro Espaço. Fontes existentes continuam locais. Revisão/revogação conservam proveniência e invalidam contexto derivado.
- Código real às 13:21: três ficheiros e três testes CMD aprovados, com saída 0 e cartões na conversa. Imagem nativa real às 13:24: PNG 1672 × 941 entregue e aberto no visualizador do projeto.
- A primeira tentativa de trabalho revelou `environments: []` a desativar o ambiente nativo. Corrigido com contrato local explícito partilhado entre runner/probe/fingerprint; prova v2 rejeita a anterior e passou 15/15 controlos reais. [Cronologia e limites](RUNTIME.md).
- Auditorias Ponytail/REA corrigiram sessão antiga, fronteiras, ambiente, cancelamento, escrita de imagem e apresentação dos resultados. [Revisão da evolução](AUDIT-EVOLUTION-PONYTAIL.md). [Maquiavel](MAQUIAVEL.md) não identificou outra funcionalidade necessária neste âmbito.
- Reinício final observado: PID 13408. A interface confirmou persistência do conhecimento, pasta e quatro artefactos. Capturas a 1280/390/320, sem transbordo observado, e viewport reposta.
- 74 testes UI/client/geometria e 18 testes finais serviço/probe/prova passaram. Tipos, Biome, migrations, boundaries e builds passaram. Não somar lotes sobrepostos dos relatórios históricos. Idiomas além de português/inglês continuam com as lacunas Spaces já existentes no fork; testes POSIX não executados no Windows.
- Ensaio sintético concluído. Aceitação humana, dados reais, outros runtimes e capacidade/quota futura da conta não são demonstrados por estes resultados. [Como utilizar](USAGE.md).

## Registo histórico do piloto inicial

- Autorização: pedido do utilizador nesta conversa para criar fork e aplicar mudanças, incluindo criação interna de projetos.
- Fork: https://github.com/oAlanSchmitt/Spaces
- Base: 071026d41f293d26cca480874cad5f66658d716c; branch feat/spaces.
- Preparação: Bun 1.4.4 local e 972 dependências instaladas com lockfile preservado.
- Decisão: org nativa por projeto, justificada pela auditoria atual e contraponto independente de Segurança/Ponytail. Negócios/espaços são navegação numa instalação única.
- Responsabilidades: Harness domínio/schema/API; Segurança gates; UI/UX página/rota/sidebar; coordenador contexto/tools/runtime/integração.
- Nome público: Spaces; rotas `/spaces`, navegação, primeiro acesso e identidade próprios, com componentes e tokens do agentes.chat.
- Implementado: catálogo, criação idempotente de projetos, contexto próprio, documentos/memórias/tarefas e recibos de fontes. Revisão de memória e arquivamento controlados pelo proprietário.
- Modelo: assinatura Codex com perfil dedicado e sem fallback de API; ligação condicionada à verificação completa do cliente instalado e login humano.
- Testes determinísticos de contexto, política, ferramentas, jobs, APIs e UI executados; conversa Codex e criação interna verificadas com dados sintéticos.
- Nenhuma mudança na instalação oficial nem migração de dados reais.

## Fronteira de verificação integrada

- Backend: 246 testes, 1311 asserções, zero falhas. UI Spaces: 24 testes, 130 asserções; fluxo de onboarding preservado: 81 testes, 487 asserções (quatro destes testes sobrepõem o lote UI).
- Tipos de DB/engine/server/web, lint, boundaries, migrações e builds web/server passaram. O lint conserva avisos de origem/fixtures; não houve novos pacotes de aplicação nem alteração do lockfile.
- Auditorias [Ponytail](AUDIT-PONYTAIL.md) e [REA](AUDIT-REA.md): corrigidos duplicados, paginação/leitura por ID, hash em streaming, arquivo/filas/handoff, recibos de payload, prova nativa, ambiente e restauro parcial. O guia está em [USAGE.md](USAGE.md).
- Maquiavel recomenda conservar o piloto antes de ampliar funções; [parecer e decisões](MAQUIAVEL.md).
- Execução real: login humano concluído, 13 canários OS passaram e a segunda prova nativa foi aceite. A revalidação após o ajuste do PATH passou num terceiro e único novo turn: duas chamadas nativas bloqueadas com IDs correlacionados e zero efeitos observados. São três turns diagnósticos no histórico, incluindo o primeiro inconclusivo; não houve retry neste lote final.
- Compatibilidade: a primeira conversa normal às 17:31 falhou na allowlist de notificações. O patch restrito passou em 28 testes/108 asserções, tipos e Biome; depois do reinício no PID 39568, a retentativa às 17:52 terminou com resposta real em português.
- Criação interna às 17:53: o coordenador criou **Validação automática Spaces (teste)** em Profissional → Cliente exemplo (teste). O novo card foi encontrado no catálogo e aberto; título/breadcrumb corretos, conversa vazia, Conhecimento 0 e Fontes 0, sem o briefing do projeto anterior. Isto verifica esse fluxo sintético, não aceitação humana ou uso com clientes reais.
- O URL relativo da resposta apareceu como Markdown literal. A ferramenta passou a usar o helper nativo `appPageLink`, conservando `SAFE_URL`: teste RED→GREEN, 3 testes/14 asserções e tipos de engine/server sem erros. Não foi repetido um clique numa nova resposta de modelo com URL absoluto.
- Após a interrupção, o PID 26288 retomou com saúde OK mas prova incompatível: o ambiente herdava PATH efémero. A factory agora fixa apenas System32/WindowsPowerShell no PATH do filho, preservando as permissões e o validador. RED→GREEN e 25 testes/106 asserções, Biome e tipos server passaram. Maquiavel reviu a correção e não recomendou novas capacidades.
- Fecho operacional: PID 26288 saiu limpo e PID 44740 ficou ready às 23:38:07 UTC. O probe do próprio daemon às 23:38:14 passou 13/13 e calculou o mesmo digest `f3931e9a…fdc00b` da nova prova nativa. A interface mostrou **Pronto para usar**; captura privada `.rheo/screenshots/Spaces-final.jpg`, recibo `.rheo/pilot-final-recovery.json`. O oficial em 4310 recusou conexão na última consulta, sem ser reiniciado ou modificado. PIDs são observações históricas; commit/envio são registados no Git.

## 15/11/2026 — Pasta associada e briefing para Codex

Primeira opção escolhida pelo utilizador e implementada: três metadados opcionais por projeto, GET/PUT autorizados por dono e diálogo **Continuar no Codex** no catálogo e na conversa. O briefing determinístico reutiliza fontes aprovadas e proveniência, com janela/orçamento explícitos. Não há leitura da pasta, execução ou chamada de modelo. Migração 0274 aditiva, anteriores preservadas.

Verificação integrada: 60 testes alvo, tipos de quatro pacotes, lint, fronteiras, migrações e builds passaram. Ponytail/REA reviram o diff, e Maquiavel recomendou fechar esta opção. O caso de controlos no caminho foi corrigido; a normalização de separadores Windows reparou uma falha anterior na verificação de geometria, sem alterar CSS global.

Backup frio privado de 2035 ficheiros, saída limpa e PID 3964 ready às 00:32:01 UTC. Probe Codex 13/13 com digest preservado, sem novo turn diagnóstico. Browser confirmou persistência, outro projeto sem herança, fonte aprovada, clipboard igual à prévia e layout a 1280/390/320. Detalhes, limites e capturas em [CODEX-HANDOFF.md](CODEX-HANDOFF.md); instruções em [USAGE.md](USAGE.md).
