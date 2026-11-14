# Spaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Entregar criação interna de projetos e navegação hierárquica com execuções protegidas e contexto separado numa única instalação.

**Architecture:** Organizações nativas são fronteiras técnicas de projeto. O catálogo global guarda somente metadados. Gates universais impedem que ferramentas e execução legadas ultrapassem o perfil protegido.

**Tech Stack:** Bun 1.4.4, TypeScript, Drizzle/PGlite, Hono, React/TanStack e componentes nativos.

**Spec:** `docs/rheo-spaces/DESIGN.md` e plano original fornecido pelo utilizador.

## Global Constraints

- Não alterar dados oficiais durante desenvolvimento; dados próprios e porta própria.
- Preservar licenças, atribuição e migrações existentes.
- Nenhuma credencial em prompts, testes, Git ou logs.
- Estado arquivado ou mapping ausente nega execução protegida.
- Sem shell/browser/conectores externos/rotinas no piloto protegido.
- Criação não copia históricos, contexto ou credenciais.

## Review Focus

- Mesmo template em projetos distintos não herda contexto nem sessão.
- Ferramenta pode ser chamada diretamente ou por aprovação antiga; ambos aplicam a política.
- Criar projeto em paralelo/repetir pedido não cria órfãos ou duplicados.
- Nova API nativa/alteração de brain não reabre execução irrestrita.
- Trocar de projeto durante streaming conserva o canal original.

### Task 0: Base e isolamento de desenvolvimento
- [x] Criar fork remoto e checkout separado; fixar commit upstream e branch própria.
- [x] Ler contratos de código e instalação sem expor segredos.
- [x] Preparar Bun já instalado e dependências dentro da cópia.
- [x] Guardar manifesto da origem, scripts de execução e diretório de dados separado.

### Task 1: Domínio e API
Owner: Harness. Schema Spaces, nova migração, serviço `rheo-spaces.ts`, router `routes/app/rheo-spaces.ts` e testes próprios.
- [x] RED: criação idempotente; destino alheio recusado; templates não copiam dados; arquivamento.
- [x] Implementar bootstrap, negócios, espaços, projetos e catálogo autenticado usando transações nativas.
- [x] GREEN: testes PGlite e migração válida.

### Task 2: Política de execução
Owner: Segurança. `rheo-policy.ts`, `tools/gateway.ts`, `tools/types.ts`, `brains/select.ts`, `context/learn.ts` e testes próprios.
- [x] RED: negar ferramenta nativa, bridge, computer brain, rotina, archived e mapping ausente.
- [x] Implementar marca durável, filtro fechado e identidade interna não serializável.
- [x] GREEN: chamadas diretas, listagem e aprovação antiga passam pelos mesmos gates.

### Task 3: Contexto e ferramentas internas
Owner: coordenador. `rheo-context.ts`, `rheo-tools.ts`, `context.ts`, `executor.ts`, registro em `apps/server/src/engine.ts` e testes próprios.
- [x] RED: contexto global/equipa de A ausente em B; criação não muda sessão; tool não aceita autoridade do modelo.
- [x] Implementar contexto protegido, ferramentas de criação/inspeção e dados classificados autorizados.
- [x] GREEN: contexto capturado e chamadas reais ao serviço em testes determinísticos.

### Task 4: Interface
Owner: UI/UX. Página Spaces, rota, sidebar, helper web, i18n e testes DOM próprios.
- [x] RED: árvore, criação com destino e requestKey, navegação, erros e arquivamento.
- [x] Implementar com componentes existentes e estado explícito do projeto.
- [x] GREEN: testes DOM e build frontend.

### Task 5: Runtime e recuperação
Owner: coordenador. Scripts de preparação/start/stop/backup, manifesto, documentação e testes de runtime.
- [x] Executar servidor e interface em dados/porta separados com fixtures sintéticas.
- [x] Testar backup/restauração em diretório separado, mantendo rotinas pausadas.
- [x] Validar coexistência com aplicação oficial; nenhuma associação automática ao runner oficial.

### Task 6: Revisão e entrega
- [x] Revisão independente do diff integrado.
- [x] Testes relevantes, lint, tipos, boundaries e build; relatar separadamente problemas prévios.
- [x] Registar evidências, limites e estado efetivamente ativo; identidade da entrega conservada no Git.


### Task 7: Assinatura e execução real
- [x] Separar autenticação normal e disponibilidade do modelo; sem fallback de API.
- [x] Validar versão/configuração/ambiente e canários OS, com prova nativa correlacionada.
- [x] Login humano e estado Pronto para usar observados no piloto.
- [x] Fechar compatibilidade de notificações e comprovar resposta/criação numa conversa real.

### Task 8: Auditoria e ponderação final pedidas pelo utilizador
- [x] Auditoria Ponytail e REA, reproduções e correções de código, runtime e proveniência.
- [x] Ponderação Maquiavel: conservar piloto e adiar capacidades sem necessidade demonstrada.
- [x] Reconciliar relatórios/guia com a execução final: fluxo real, auditorias, revalidação PATH e interface pronta. Entrega da branch conservada no Git.
