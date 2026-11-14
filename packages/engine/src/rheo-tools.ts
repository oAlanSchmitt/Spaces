import { createHash } from "node:crypto";
import { and, eq, schema } from "@agenteschat/db";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { appPageLink } from "./message-links";
import { rheoEntryPayload } from "./rheo-entry-payload";
import { assertRheoSourcesCurrent, listRheoRunEntries, recordRheoSources, withRheoPublication } from "./rheo-knowledge";
import { assertRheoRun } from "./rheo-policy";
import { createRheoProject, listRheoSpaces } from "./rheo-spaces";
import {
  RHEO_INTERNAL_TOOL,
  type ToolContext,
  type ToolDefinition,
  type ToolOutput,
  type ToolSource,
} from "./tools/types";
import { untrustedBlock } from "./untrusted";

const stringField = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const shape = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const text = (value: unknown) => (typeof value === "string" ? value : "");

async function policyOf(ctx: ToolContext) {
  const policy = await assertRheoRun(ctx.db, { id: ctx.runId, ...ctx }, { brain: "model", bridge: ctx.bridge });
  if (!policy) throw new ForbiddenError();
  await assertRheoSourcesCurrent(ctx.db, ctx.orgId, ctx.runId);
  return policy;
}

async function entriesFor(ctx: ToolContext, kind?: "document" | "memory" | "task", id?: string) {
  await policyOf(ctx);
  const selected = await listRheoRunEntries(ctx.db, ctx.orgId, kind, id);
  if (id && !selected.length) throw new NotFoundError();
  const payload = rheoEntryPayload(selected, 38_000);
  await recordRheoSources(ctx.db, {
    orgId: ctx.orgId,
    runId: ctx.runId,
    channelId: ctx.channelId,
    agentId: ctx.agentId,
    entryIds: payload.entries.map((entry) => entry.id),
  });
  return {
    content: untrustedBlock("Reviewed project entries", JSON.stringify(payload), 40_000),
  };
}

export function createRheoToolSource(): ToolSource {
  return {
    name: "rheo-spaces",
    rheoInternal: RHEO_INTERNAL_TOOL,
    async tools(ctx) {
      const policy = await assertRheoRun(ctx.db, { id: ctx.runId, ...ctx }, { brain: "model", bridge: ctx.bridge });
      if (!policy) return [];
      const define = (tool: Omit<ToolDefinition, "scope" | "rheoInternal">): ToolDefinition => ({
        ...tool,
        scope: "",
        rheoInternal: RHEO_INTERNAL_TOOL,
        async execute(input, call) {
          try {
            await policyOf(call);
            return await tool.execute(input, call);
          } catch (error) {
            return {
              content: error instanceof Error ? error.message : "Não foi possível concluir a operação.",
              isError: true,
            };
          }
        },
      });
      const inspect = define({
        name: "rheo_inspect",
        description:
          "Mostra o projeto e fontes autorizadas desta execução, sem segredos nem conteúdo de outros projetos.",
        inputSchema: shape({}),
        async execute(_input, call) {
          const current = await policyOf(call);
          const [receipt] = await call.db
            .select()
            .from(schema.rheoContextReceipts)
            .where(
              and(eq(schema.rheoContextReceipts.orgId, call.orgId), eq(schema.rheoContextReceipts.runId, call.runId)),
            );
          return {
            content: JSON.stringify({
              kind: current.kind,
              orgId: call.orgId,
              channelId: call.channelId,
              agentId: call.agentId,
              runId: call.runId,
              profile: "protected",
              entryIds: receipt?.entryIds ?? [],
              externalActions: false,
              computerExecution: false,
            }),
          };
        },
      });
      if (policy.kind === "control")
        return [
          inspect,
          define({
            name: "rheo_list",
            description:
              "Lista negócios, espaços e projetos autorizados, apenas metadados. Use para escolher o destino explícito de um projeto novo.",
            inputSchema: shape({}),
            async execute(_input, call) {
              const current = await policyOf(call);
              return {
                content: untrustedBlock(
                  "Project catalog metadata",
                  JSON.stringify(await listRheoSpaces(call.db, current.ownerUserId)),
                  40_000,
                ),
              };
            },
          }),
          define({
            name: "rheo_create_project",
            description:
              "Cria um projeto novo e isolado quando a pessoa o pede. Use o spaceId exato de rheo_list. Não copia conversas ou dados e não muda a sessão atual. Devolva o link para a pessoa entrar no novo projeto.",
            inputSchema: shape({ name: stringField(80), spaceId: stringField(36), templateId: stringField(36) }, [
              "name",
              "spaceId",
            ]),
            async execute(input, call) {
              const current = await policyOf(call);
              if (current.kind !== "control") throw new ForbiddenError();
              const name = text(input.name);
              const spaceId = text(input.spaceId);
              const templateId = text(input.templateId) || undefined;
              const requestKey = `agent:${call.runId}:${createHash("sha256").update(JSON.stringify({ name, spaceId, templateId })).digest("hex").slice(0, 32)}`;
              const project = await createRheoProject(call.db, current.ownerUserId, {
                name,
                spaceId,
                templateId,
                requestKey,
              });
              const path = appPageLink(project.orgId, `/c/${project.channelId}`);
              return {
                content: JSON.stringify({
                  ...project,
                  path,
                  message: `Projeto criado. [Abrir ${project.name}](${path}). Esta conversa continua no painel global.`,
                }),
                data: { projectId: project.id, path },
              };
            },
          }),
        ];
      return [
        inspect,
        define({
          name: "rheo_context",
          description:
            "Lê fontes revistas e comuns deste projeto. Material reservado ao proprietário e propostas pendentes não estão disponíveis.",
          inputSchema: shape({}),
          async execute(_input, call) {
            return entriesFor(call);
          },
        }),
        define({
          name: "rheo_documents",
          description: "Lista ou lê documentos aprovados para os agentes deste projeto.",
          inputSchema: shape({ id: stringField(36) }),
          async execute(input, call) {
            return entriesFor(call, "document", text(input.id) || undefined);
          },
        }),
        define({
          name: "rheo_memory",
          description:
            "Lê memória aprovada ou propõe uma memória para revisão humana. Uma proposta não passa a facto nem entra no contexto automaticamente.",
          inputSchema: shape(
            {
              action: { type: "string", enum: ["list", "propose"] },
              title: stringField(160),
              body: stringField(40_000),
            },
            ["action"],
          ),
          async execute(input, call) {
            if (input.action === "list") return entriesFor(call, "memory");
            const title = text(input.title).trim();
            const body = text(input.body);
            if (!title || title.length > 160 || !body || body.length > 40_000)
              throw new ValidationError("A proposta precisa de título e conteúdo.");
            const [entry] = await withRheoPublication(call.db, call.orgId, call.runId, (tx) =>
              tx
                .insert(schema.rheoEntries)
                .values({
                  orgId: call.orgId,
                  kind: "memory",
                  state: "proposed",
                  visibility: "project",
                  title,
                  body,
                  createdByAgentId: call.agentId,
                  sourceRunId: call.runId,
                })
                .returning({ id: schema.rheoEntries.id }),
            );
            return {
              content: JSON.stringify({
                ...entry,
                state: "proposed",
                message: "Memória proposta para revisão no Conhecimento do projeto.",
              }),
            };
          },
        }),
        define({
          name: "rheo_tasks",
          description:
            "Lista ou regista itens de ação no Conhecimento deste projeto. Não altera o quadro Tarefas nem inicia execução de código ou publicações externas.",
          inputSchema: shape(
            {
              action: { type: "string", enum: ["list", "create"] },
              title: stringField(160),
              body: stringField(40_000),
            },
            ["action"],
          ),
          async execute(input, call): Promise<ToolOutput> {
            if (input.action === "list") return entriesFor(call, "task");
            const title = text(input.title).trim();
            const body = text(input.body);
            if (!title || title.length > 160 || body.length > 40_000)
              throw new ValidationError("O item de ação precisa de um título válido.");
            const [entry] = await withRheoPublication(call.db, call.orgId, call.runId, (tx) =>
              tx
                .insert(schema.rheoEntries)
                .values({
                  orgId: call.orgId,
                  kind: "task",
                  state: "approved",
                  visibility: "project",
                  title,
                  body,
                  createdByAgentId: call.agentId,
                  sourceRunId: call.runId,
                })
                .returning({ id: schema.rheoEntries.id }),
            );
            return {
              content: JSON.stringify({
                ...entry,
                title,
                message: "Item de ação registado no Conhecimento deste projeto.",
              }),
            };
          },
        }),
      ];
    },
  };
}
