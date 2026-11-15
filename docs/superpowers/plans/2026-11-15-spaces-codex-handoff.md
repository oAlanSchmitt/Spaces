# Spaces Codex Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Associar uma pasta a um projeto e preparar um briefing copiável para continuar no Codex.

**Architecture:** Metadados opcionais no projeto; serviço determinístico autorizado por proprietário; diálogo nativo no catálogo e na conversa. Reutilizar recuperação de fontes aprovada. A pasta não é acedida pelo servidor.

**Tech Stack:** Bun, TypeScript, Drizzle/PGlite, Hono, React/TanStack, componentes agentes.chat.

**Spec:** `docs/rheo-spaces/CODEX-HANDOFF.md`. A primeira opção e a execução foram explicitamente escolhidas pelo utilizador. Continuar no fork isolado existente, preservando os caminhos e os dados do piloto.

## Global Constraints

- Não ler/escrever a pasta associada nem alterar permissões Codex.
- Não alterar migrações existentes, dependências ou instalação oficial.
- Nome público Spaces, Design System existente, conteúdo do briefing limitado ao projeto e aprovado.
- Metadados da pasta não entram automaticamente no contexto dos agentes.

## Review Focus

- Pasta não existente, relativa, UNC, com espaços ou caracteres de controlo.
- Dono alheio, projeto arquivado, fonte privada/proposta/revogada ou de outro projeto.
- Conhecimento acima do orçamento e IDs que não foram incluídos no texto.
- Clipboard recusado, mudança de projeto e alterações depois de preparar prévia.
- Caminhos/nomes compridos em largura estreita sem clipping nem perda de ações.

### Task 1: Persistência, serviço e API

Owner: Harness. Schema/migração nova, `rheo-handoff.ts`, exports, rotas Spaces e testes engine/server.

- [x] RED: configuração por proprietário, validação/remover caminho, briefing com fontes e exclusões.
- [x] Implementar contrato GET/PUT da spec e migração gerada sem alterar snapshots anteriores.
- [x] GREEN: testes afetados, tipos e verificação de migrações.

### Task 2: Interface

Owner: UI/UX. Novo diálogo, helper web, pontos de entrada no catálogo e contexto, i18n e testes DOM.

- [x] RED: guardar/preparar, copiar/falhar/repetir, limpar vínculo, prévia invalidada e estado arquivado.
- [x] Implementar com Dialog, Field/Input/Textarea/Button, tokens e helper de clipboard existentes.
- [x] GREEN: testes DOM, tipos e build frontend.

### Task 3: Integração e entrega

Owner: coordenador. REA acompanha limites, Ponytail revê a alteração integrada.

- [x] Rever APIs/fontes/efeitos e corrigir achados.
- [x] Executar verificações proporcionais e teste visual real no piloto com fixture sintética.
- [x] Atualizar guia e registar limites. Identidade da entrega e envio conservados no Git.
