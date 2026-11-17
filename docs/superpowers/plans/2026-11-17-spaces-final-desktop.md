# Spaces: auditoria final e executável Windows

**Objetivo:** auditar a evolução entregue em `826393c`, corrigir falhas comprovadas e abrir a versão auditada por um executável na Área de Trabalho.

**Arquitetura:** reutilizar `native-package.ts` para congelar servidor, interface, migrations e dependências WASM. Um lançador Windows pequeno, compilado com o C# do Windows, chama a manutenção PowerShell existente. O pacote fixa a raiz privada original em tempo de build; dados e autenticação não são copiados. Manifesto e hashes impedem abrir silenciosamente outros bits. O servidor oficial 4310 permanece separado.

**Limites:** instalação local deste PC, não um instalador portátil; sem atualizador automático, novos provedores, dependências ou alteração do Design System. Dados continuam em `.rheo/pilot-data`, serviço 4410. Futuras versões precisam de nova entrega explícita.

## Plano de implementação

- [x] Auditoria independente Ponytail dos caminhos de conhecimento, execução e artefactos, com reprodução dos achados. Aplicar apenas correções confirmadas com teste de regressão.
- [x] Centralizar raiz privada e permitir override apenas no build local. Testar fonte e bundle sem alterar a identidade do Codex.
- [x] Reutilizar Start/Stop com contexto de release explícito e validado. Testar integridade, versão errada, processo já ativo e erro de arranque.
- [x] Construir pacote congelado e `Spaces.exe`, registar commit e SHA-256. Colocar executável na Área de Trabalho.
- [x] Parar piloto pelo supervisor, backup frio, abrir executável e verificar identidade, health e interface; repetir abertura sem duplicar servidor. Registar verificações e limites.

Entrega: `spaces-0b2e2f4b2661`, PID 27868, executável da Área de Trabalho verificado. Evidências e limites em `docs/rheo-spaces/AUDIT-FINAL-DESKTOP.md`.

## Pontos de revisão

- Recusar manifesto/ficheiros alterados e caminhos fora da release.
- Não matar processos por porta ou PID sem identidade; conflito com outra versão gera erro explícito.
- Não copiar nem apresentar credenciais; preservar home, raiz de projeto e fingerprint/provas existentes.
- Não tratar um teste sintético ou build como aceitação de projeto real.
- Expor falhas de arranque ao utilizador, sem janelas de consola permanentes.

**Resumo para validar:** versão auditada congelada, correções necessárias e um executável local; dados existentes preservados e futuras edições do checkout não mudam o pacote entregue.
