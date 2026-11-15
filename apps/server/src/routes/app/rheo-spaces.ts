import {
  bootstrapRheoSpaces,
  createRheoBusiness,
  createRheoProject,
  createRheoSpace,
  getRheoProjectHandoff,
  listRheoSpaces,
  prepareRheoProjectHandoff,
  setRheoProjectState,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { type AppDeps, body, createAppRouter, errors, json, requireSession, security } from "./context";

const tags = ["Spaces"];
const Name = z.string().trim().min(1).max(80);
const State = z.enum(["active", "archived"]);
const Named = z.object({ id: z.uuid(), name: z.string() });
const Project = Named.extend({ orgId: z.uuid(), channelId: z.uuid(), state: State });
const Handoff = z
  .object({
    folderPath: z.string().max(2000).nullable(),
    objective: z.string().max(4000),
    criteria: z.string().max(4000),
  })
  .strict();
const Overview = z.object({
  controlOrgId: z.uuid().nullable(),
  controlChannelId: z.uuid().nullable(),
  businesses: z.array(Named.extend({ spaces: z.array(Named.extend({ projects: z.array(Project) })) })),
  templates: z.array(Named.extend({ version: z.string() })),
});

export function rheoSpacesRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  const session = requireSession(deps.auth);
  app.use("/spaces", session);
  app.use("/spaces/*", session);

  app.openapi(
    createRoute({
      method: "get",
      path: "/spaces",
      tags,
      security,
      summary: "Read your Spaces structure",
      responses: { 200: json(Overview), ...errors },
    }),
    async (c) => c.json(await listRheoSpaces(deps.db, c.get("user").id), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/spaces/bootstrap",
      tags,
      security,
      summary: "Create your protected Spaces panel",
      request: { body: body(z.object({}).strict()) },
      responses: { 200: json(Overview), ...errors },
    }),
    async (c) => c.json(await bootstrapRheoSpaces(deps.db, c.get("user").id), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/spaces/businesses",
      tags,
      security,
      summary: "Create a business in your panel",
      request: { body: body(z.object({ name: Name }).strict()) },
      responses: { 201: json(Named, "Created"), ...errors },
    }),
    async (c) => c.json(await createRheoBusiness(deps.db, c.get("user").id, c.req.valid("json")), 201),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/spaces/spaces",
      tags,
      security,
      summary: "Create a client or internal space",
      request: { body: body(z.object({ businessId: z.uuid(), name: Name }).strict()) },
      responses: { 201: json(Named, "Created"), ...errors },
    }),
    async (c) => c.json(await createRheoSpace(deps.db, c.get("user").id, c.req.valid("json")), 201),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/spaces/projects",
      tags,
      security,
      summary: "Provision a project in a separate native workspace",
      request: {
        body: body(
          z
            .object({
              spaceId: z.uuid(),
              name: Name,
              templateId: z.uuid().optional(),
              requestKey: z.string().trim().min(1).max(120),
            })
            .strict(),
        ),
      },
      responses: { 201: json(Project, "Created"), ...errors },
    }),
    async (c) => c.json(await createRheoProject(deps.db, c.get("user").id, c.req.valid("json")), 201),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/spaces/projects/{projectId}",
      tags,
      security,
      summary: "Archive or reopen a project",
      request: { params: z.object({ projectId: z.uuid() }), body: body(z.object({ state: State }).strict()) },
      responses: { 200: json(Project), ...errors },
    }),
    async (c) =>
      c.json(
        await setRheoProjectState(
          deps.db,
          c.get("user").id,
          c.req.valid("param").projectId,
          c.req.valid("json").state,
          deps.adapters.pubsub,
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/spaces/projects/{projectId}/handoff",
      tags,
      security,
      summary: "Read your project's Codex handoff references",
      request: { params: z.object({ projectId: z.uuid() }) },
      responses: { 200: json(Handoff), ...errors },
    }),
    async (c) => c.json(await getRheoProjectHandoff(deps.db, c.get("user").id, c.req.valid("param").projectId), 200),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/spaces/projects/{projectId}/handoff",
      tags,
      security,
      summary: "Save project references and prepare a portable Codex briefing",
      request: { params: z.object({ projectId: z.uuid() }), body: body(Handoff) },
      responses: {
        200: json(
          Handoff.extend({
            briefing: z.string(),
            entryIds: z.array(z.uuid()),
            omittedCount: z.number().int().nonnegative(),
          }),
        ),
        ...errors,
      },
    }),
    async (c) =>
      c.json(
        await prepareRheoProjectHandoff(deps.db, c.get("user").id, c.req.valid("param").projectId, c.req.valid("json")),
        200,
      ),
  );
  return app;
}
