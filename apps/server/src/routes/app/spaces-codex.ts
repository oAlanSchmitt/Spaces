import { createRoute, z } from "@hono/zod-openapi";
import type { SpacesCodex } from "../../spaces-codex";
import { type AppDeps, body, createAppRouter, errors, json, requireSession, security } from "./context";

export function spacesCodexRoutes(deps: AppDeps, service: SpacesCodex) {
  const app = createAppRouter(deps);
  const session = requireSession(deps.auth);
  app.use("/spaces/codex", session);
  app.use("/spaces/codex/*", session);
  const tags = ["Spaces"];
  const Status = z.object({
    installed: z.boolean(),
    connected: z.boolean(),
    compatible: z.boolean(),
    loginAvailable: z.boolean(),
    sandbox: z.enum(["pending", "ready", "blocked"]),
    version: z.string().nullable(),
    message: z.string().optional(),
  });
  app.openapi(
    createRoute({
      method: "get",
      path: "/spaces/codex",
      tags,
      security,
      summary: "Check the Spaces Codex subscription connection",
      responses: { 200: json(Status), ...errors },
    }),
    async (c) => c.json(await service.status(c.get("user").id), 200),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/spaces/codex/login",
      tags,
      security,
      summary: "Start the owner's normal ChatGPT subscription login",
      request: { body: body(z.object({}).strict()) },
      responses: { 200: json(z.object({ authUrl: z.string().url() })), ...errors },
    }),
    async (c) => c.json(await service.login(c.get("user").id), 200),
  );
  return app;
}
