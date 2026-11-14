import { desc, eq, schema } from "@agenteschat/db";
import { createRheoEntry, listRheoEntries, requireRheoOwner, reviewRheoEntry } from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { type AppDeps, body, createAppRouter, errors, json, requireSession, security } from "./context";

const tags = ["Spaces"];
const Params = z.object({ orgId: z.uuid() });
const Entry = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  kind: z.enum(["document", "memory", "task"]),
  visibility: z.enum(["project", "owner"]),
  state: z.enum(["approved", "proposed", "archived"]),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const Knowledge = z.object({
  profile: z.literal("protected"),
  state: z.enum(["active", "archived"]),
  entries: z.array(Entry),
  nextCursor: z.uuid().nullable(),
  receipts: z.array(
    z.object({
      runId: z.uuid(),
      entryIds: z.array(z.string()),
      messageIds: z.array(z.string()),
      createdAt: z.string(),
    }),
  ),
});

export function rheoKnowledgeRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("/spaces/workspaces/*", requireSession(deps.auth));
  app.openapi(
    createRoute({
      method: "get",
      path: "/spaces/workspaces/{orgId}/knowledge",
      tags,
      security,
      request: { params: Params, query: z.object({ before: z.uuid().optional() }) },
      responses: { 200: json(Knowledge), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const userId = c.get("user").id;
      const policy = await requireRheoOwner(deps.db, userId, orgId);
      const page = await listRheoEntries(deps.db, userId, orgId, { beforeId: c.req.valid("query").before, limit: 51 });
      const entries = page.slice(0, 50);
      const nextCursor = page.length > 50 ? (entries.at(-1)?.id ?? null) : null;
      const receipts = await deps.db
        .select({
          runId: schema.rheoContextReceipts.runId,
          entryIds: schema.rheoContextReceipts.entryIds,
          messageIds: schema.rheoContextReceipts.messageIds,
          createdAt: schema.rheoContextReceipts.createdAt,
        })
        .from(schema.rheoContextReceipts)
        .where(eq(schema.rheoContextReceipts.orgId, orgId))
        .orderBy(desc(schema.rheoContextReceipts.createdAt))
        .limit(20);
      return c.json({ profile: "protected" as const, state: policy.state, entries, nextCursor, receipts }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/spaces/workspaces/{orgId}/entries",
      tags,
      security,
      request: {
        params: Params,
        body: body(
          z
            .object({
              kind: z.enum(["document", "memory", "task"]),
              title: z.string().trim().min(1).max(160),
              body: z.string().max(40_000),
              visibility: z.enum(["project", "owner"]).default("owner"),
            })
            .strict(),
        ),
      },
      responses: { 201: json(Entry), ...errors },
    }),
    async (c) =>
      c.json(await createRheoEntry(deps.db, c.get("user").id, c.req.valid("param").orgId, c.req.valid("json")), 201),
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/spaces/workspaces/{orgId}/entries/{entryId}",
      tags,
      security,
      request: {
        params: Params.extend({ entryId: z.uuid() }),
        body: body(z.object({ state: z.enum(["approved", "archived"]) }).strict()),
      },
      responses: { 200: json(Entry), ...errors },
    }),
    async (c) => {
      const { orgId, entryId } = c.req.valid("param");
      return c.json(await reviewRheoEntry(deps.db, c.get("user").id, orgId, entryId, c.req.valid("json").state), 200);
    },
  );
  return app;
}
