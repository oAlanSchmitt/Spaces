import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, schema } from "@agenteschat/db";
import {
  type ArtifactDeps,
  absorbToolData,
  bootstrapRheoSpaces,
  createRheoProject,
  postPersonMessage,
  setMessageLinkBase,
  type ToolContext,
  type ToolSideEffects,
} from "@agenteschat/engine";
import { type Fixture, setup } from "../../../packages/engine/test/fixtures";
import type { CodexAppRunner, CodexTurnInput } from "../runner/brain-codex";
import { CodexAppMapper } from "../runner/brain-codex-app";
import { createSpacesWork, type SpacesWork, spacesWorkLaunch } from "../src/spaces-work";

let f: Fixture;
let artifacts: ArtifactDeps;
let base: string;
let root: string;
let home: string;
let project: { id: string; orgId: string; channelId: string };
let ctx: ToolContext;
let service: SpacesWork;
let ready = true;
let probeSuccess = false;
let probes = 0;
let account = "synthetic-chatgpt-account";
let handler: CodexAppRunner["turn"];
const turns: CodexTurnInput[] = [];
beforeEach(async () => {
  setMessageLinkBase("http://127.0.0.1:43199");
  f = await setup();
  const fixtureArtifacts = f.jobDeps.artifacts;
  if (!fixtureArtifacts) throw new Error("Missing fixture artifacts");
  artifacts = fixtureArtifacts;
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), "spaces-work-test-")));
  root = path.join(base, "project");
  home = path.join(base, "private", "codex");
  await mkdir(root, { recursive: true });
  await mkdir(home, { recursive: true });
  const overview = await bootstrapRheoSpaces(f.db, f.owner.id);
  const initialProject = overview.businesses.flatMap((b) => b.spaces.flatMap((s) => s.projects))[0];
  if (!initialProject) throw new Error("Missing fixture project");
  project = initialProject;
  const [agent] = await f.db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, project.orgId), eq(schema.agents.handle, "coordenador")));
  if (!agent) throw new Error("Missing coordinator");
  const message = await postPersonMessage(f, f.owner.id, project.orgId, project.channelId, {
    body: "@coordenador Cria e testa o código e uma imagem",
  });
  const [run] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.orgId, project.orgId), eq(schema.agentRuns.triggerMessageId, message.id)));
  if (!run) throw new Error("Missing run");
  ctx = {
    db: f.db,
    orgId: project.orgId,
    channelId: project.channelId,
    agentId: agent.id,
    runId: run.id,
    threadRootId: run.threadRootId,
    triggerMessageId: message.id,
    toolUseId: "work-1",
    signal: new AbortController().signal,
  };
  turns.length = 0;
  ready = true;
  probeSuccess = false;
  probes = 0;
  account = "synthetic-chatgpt-account";
  handler = async (_input, opts) => {
    opts.emit({ type: "done", text: "Done" });
  };
  service = createSpacesWork({
    db: f.db,
    home,
    identity: async () => ({
      version: "0.167.0-alpha.4.1",
      executableSha256: "a".repeat(64),
      accountFingerprint: account,
      command: "synthetic-codex",
    }),
    exclusive: (work) => work(),
    proof: async () => ready,
    probe: async () => {
      probes++;
      if (probeSuccess) ready = true;
      return { ready, message: ready ? "synthetic ready" : "synthetic pending", results: [] };
    },
    runner: {
      async turn(input, opts, fallback) {
        turns.push(input);
        return handler(input, opts, fallback);
      },
    },
    recheckMs: 5,
  });
});
afterEach(async () => {
  setMessageLinkBase("http://localhost:3000");
  service?.stop();
  await f?.close();
  if (
    base &&
    path.basename(base).startsWith("spaces-work-test-") &&
    path.dirname(base).toLowerCase() === (await realpath(os.tmpdir())).toLowerCase()
  )
    await rm(base, { recursive: true, force: true });
});

test("work launch uses the dedicated account with a separate named write profile, closed env and no MCP", () => {
  const launch = spacesWorkLaunch({
    home,
    workspace: root,
    env: {
      PATH: "synthetic-path",
      SystemRoot: "C:\\Windows",
      OPENAI_API_KEY: "must-not-leak",
      PRIVATE_TOKEN: "must-not-leak",
    },
  });
  expect(launch.args).toContain('default_permissions="spaces-work"');
  expect(launch.args.join(" ")).toContain(`${JSON.stringify(root)}="write"`);
  expect(launch.args).toContain("features.code_mode_host=true");
  expect(launch.args).toContain("features.image_generation=true");
  expect(launch.args).toContain("mcp_servers={}");
  expect(launch.args.join(" ")).not.toContain("sandbox_workspace_write");
  expect(launch.env.CODEX_HOME).toBe(home);
  expect(launch.env.TEMP).toBe(path.join(root, ".spaces", "tmp"));
  expect(launch.env).not.toHaveProperty("OPENAI_API_KEY");
  expect(launch.env).not.toHaveProperty("PRIVATE_TOKEN");
});

test("bindings check revisions, canonical roots, other projects and account drift", async () => {
  expect((await service.status(f.owner.id, project.id)).status).toBe("unconfigured");
  await expect(service.bind(f.owner.id, project.id, { folderPath: home, revision: null })).rejects.toThrow();
  await expect(
    service.bind(f.owner.id, project.id, { folderPath: path.parse(root).root, revision: null }),
  ).rejects.toThrow();
  const bound = await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  const revision = bound.revision;
  if (!revision) throw new Error("Missing binding revision");
  expect(bound).toMatchObject({ folderPath: root, configured: true, status: "ready" });
  await expect(service.bind(f.owner.id, project.id, { folderPath: root, revision: null })).rejects.toThrow(
    "associação mudou",
  );
  const overview = await bootstrapRheoSpaces(f.db, f.owner.id);
  const space = overview.businesses.flatMap((business) => business.spaces)[0];
  if (!space) throw new Error("Missing fixture space");
  const second = await createRheoProject(f.db, f.owner.id, {
    spaceId: space.id,
    name: "Second work",
    requestKey: randomUUID(),
  });
  const nested = path.join(root, "nested");
  await mkdir(nested);
  await expect(service.bind(f.owner.id, second.id, { folderPath: nested, revision: null })).rejects.toThrow(
    "outro projeto",
  );
  account = "changed-account";
  expect((await service.status(f.owner.id, project.id)).status).toBe("blocked");
  expect(await service.unbind(f.owner.id, project.id, revision)).toMatchObject({ status: "unconfigured" });
});

test("unverified work never starts a turn and association runs the deterministic probe", async () => {
  ready = false;
  const failed = await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  expect(failed).toMatchObject({
    status: "blocked",
    message: "synthetic pending",
  });
  await expect(service.execute({ instruction: "Create code" }, ctx, artifacts)).rejects.toThrow("prova de isolamento");
  expect(turns).toHaveLength(0);
  expect(await service.status(f.owner.id, project.id)).toMatchObject({
    status: "blocked",
    message: "synthetic pending",
  });
  probeSuccess = true;
  expect(await service.bind(f.owner.id, project.id, { folderPath: root, revision: failed.revision })).toMatchObject({
    status: "ready",
  });
  expect(probes).toBe(2);
});

test("native code/test and image events create project-conversation artifacts and a replay does not rerun effects", async () => {
  await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  handler = async (input, opts) => {
    expect(input.account?.home).toBe(home);
    expect(input.cwd).toBe(root);
    expect(input.mcp).toEqual({ token: "", tools: "" });
    await writeFile(path.join(root, "answer.js"), "export const answer = 42;\n");
    const mapper = new CodexAppMapper({ cwd: root, folder: root, confined: true });
    for (const item of [
      {
        id: "explore",
        type: "commandExecution",
        command: "unavailable exploratory command",
        aggregatedOutput: "Unavailable during exploration",
        exitCode: 1,
        status: "failed",
      },
      {
        id: "code",
        type: "fileChange",
        status: "completed",
        changes: [{ path: path.join(root, "answer.js"), kind: { type: "create" } }],
      },
      {
        id: "test",
        type: "commandExecution",
        command: "test answer = 42",
        aggregatedOutput: "1 test passed",
        exitCode: 0,
        status: "completed",
      },
      {
        id: "picture",
        type: "imageGeneration",
        result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ0YAAAAASUVORK5CYII=",
      },
    ])
      for (const event of mapper.completed(item).events) opts.emit(event);
    opts.emit({ type: "usage", input: 31, output: 7, source: "plan" });
    opts.emit({ type: "done", text: "Code tested and picture generated" });
  };
  const result = await service.execute({ instruction: "Create and test code and a picture" }, ctx, artifacts);
  expect(result.isError).toBeUndefined();
  expect(result.data?.artifacts as unknown[]).toHaveLength(2);
  const payload = JSON.parse(result.content);
  expect(payload.calls.find((call: { id: string }) => call.id === "explore").executed.isError).toBe(true);
  for (const file of payload.files) {
    const url = new URL(file.url);
    expect(url.origin).toBe("http://127.0.0.1:43199");
    expect(url.pathname).toBe(`/org/${project.orgId}/drive`);
    expect(url.searchParams.get("artifact")).toBe(file.id);
    expect(url.searchParams.get("v")).toBe(String(file.version));
  }
  const effects: ToolSideEffects = {};
  absorbToolData(effects, result.data);
  expect(effects.artifacts).toHaveLength(2);
  const rows = await f.db.select().from(schema.artifacts).where(eq(schema.artifacts.orgId, project.orgId));
  expect(rows.filter((row) => row.channelId === project.channelId)).toHaveLength(2);
  expect(
    JSON.parse(result.content).calls.some(
      (call: { name: string; executed: { content: string } }) =>
        call.name === "shell" && call.executed.content.includes("1 test passed"),
    ),
  ).toBe(true);
  expect(await service.execute({ instruction: "Same call" }, ctx, artifacts)).toEqual(result);
  expect(turns).toHaveLength(1);
  const [usage] = await f.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.runId, ctx.runId));
  expect(usage).toMatchObject({
    orgId: project.orgId,
    agentId: ctx.agentId,
    billedTo: "plan",
    costNanoUsd: 0,
    inputTokens: 31,
    outputTokens: 7,
  });
});

test("cancellation and revocation stop the native turn and retain observed usage without publishing", async () => {
  const bound = await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  const revision = bound.revision;
  if (!revision) throw new Error("Missing binding revision");
  const { promise: began, resolve: started } = Promise.withResolvers<void>();
  handler = async (_input, opts) => {
    opts.emit({ type: "usage", input: 5, output: 2, source: "plan" });
    started();
    await new Promise<void>((resolve) =>
      opts.signal.addEventListener(
        "abort",
        () => {
          opts.emit({ type: "error", code: "canceled", message: "Canceled" });
          resolve();
        },
        { once: true },
      ),
    );
  };
  const run = service.execute({ instruction: "Wait for cancellation" }, ctx, artifacts);
  await began;
  await service.unbind(f.owner.id, project.id, revision);
  expect((await run).isError).toBe(true);
  expect(await f.db.select().from(schema.artifacts).where(eq(schema.artifacts.orgId, project.orgId))).toHaveLength(0);
  expect(await f.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.runId, ctx.runId))).toHaveLength(1);
});

test("new work calls get fresh native sessions and current approved knowledge", async () => {
  await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  const [entry] = await f.db
    .insert(schema.rheoEntries)
    .values({
      orgId: project.orgId,
      title: "Current requirement",
      body: "source-version-one",
      kind: "document",
      state: "approved",
      visibility: "project",
      createdByUserId: f.owner.id,
    })
    .returning();
  if (!entry) throw new Error("Missing source");
  await service.execute({ instruction: "First" }, ctx, artifacts);
  await f.db.update(schema.agentRuns).set({ status: "done" }).where(eq(schema.agentRuns.id, ctx.runId));
  await f.db
    .update(schema.rheoEntries)
    .set({ body: "source-version-two", revision: 2 })
    .where(eq(schema.rheoEntries.id, entry.id));
  // A new owner request has its own source receipt, as real conversation turns do.
  const message = await postPersonMessage(f, f.owner.id, project.orgId, project.channelId, {
    body: "@coordenador Continue",
  });
  const [run] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.orgId, project.orgId), eq(schema.agentRuns.triggerMessageId, message.id)));
  if (!run) throw new Error("Missing second run");
  const next = {
    ...ctx,
    runId: run.id,
    triggerMessageId: message.id,
    threadRootId: run.threadRootId,
    toolUseId: "work-2",
  };
  await service.execute({ instruction: "Second" }, next, artifacts);
  expect(turns).toHaveLength(2);
  const [firstTurn, secondTurn] = turns;
  if (!firstTurn || !secondTurn) throw new Error("Missing expected work turns");
  expect(firstTurn.sessionId).not.toBe(secondTurn.sessionId);
  expect(firstTurn.prompt).toContain("source-version-one");
  expect(secondTurn.prompt).toContain("source-version-two");
  expect(secondTurn.prompt).not.toContain("source-version-one");
});

test("a junction in the work scratch path cannot cause writes outside the bound root", async () => {
  await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  const outside = path.join(base, "other-project");
  await mkdir(outside);
  await symlink(outside, path.join(root, ".spaces"), process.platform === "win32" ? "junction" : "dir");
  const result = await service.execute({ instruction: "Create code" }, ctx, artifacts);
  expect(result.isError).toBe(true);
  expect(turns).toHaveLength(0);
  await expect(readFile(path.join(outside, "tmp"))).rejects.toThrow();
});

test("an ended native transport without completion is an explicit failure and is not retried", async () => {
  await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  handler = async () => {};
  const result = await service.execute({ instruction: "Create code" }, ctx, artifacts);
  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content).error).toContain("sem confirmação");
  expect(await service.execute({ instruction: "Same call" }, ctx, artifacts)).toEqual(result);
  expect(turns).toHaveLength(1);
});

test("budget and an already-canceled request prevent native work", async () => {
  await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  const controller = new AbortController();
  controller.abort();
  await expect(
    service.execute({ instruction: "Canceled" }, { ...ctx, signal: controller.signal }, artifacts),
  ).rejects.toThrow();
  await f.db.update(schema.agents).set({ monthlyBudgetNanoUsd: 0 }).where(eq(schema.agents.id, ctx.agentId));
  await expect(service.execute({ instruction: "Over budget" }, ctx, artifacts)).rejects.toThrow();
  expect(turns).toHaveLength(0);
});

test("archived projects keep their owner-readable binding and permit revocation", async () => {
  const bound = await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  const revision = bound.revision;
  if (!revision) throw new Error("Missing binding revision");
  await f.db.update(schema.rheoProjects).set({ state: "archived" }).where(eq(schema.rheoProjects.id, project.id));
  await f.db
    .update(schema.rheoWorkspaces)
    .set({ state: "archived" })
    .where(eq(schema.rheoWorkspaces.orgId, project.orgId));
  expect(await service.status(f.owner.id, project.id)).toMatchObject({ folderPath: root, status: "blocked" });
  expect(await service.unbind(f.owner.id, project.id, revision)).toMatchObject({ status: "unconfigured" });
});

test("delivery stays inside the project and explicitly reports paths omitted by its cap", async () => {
  await service.bind(f.owner.id, project.id, { folderPath: root, revision: null });
  await writeFile(path.join(base, "private", "secret.txt"), "synthetic-secret-not-for-export");
  handler = async (_input, opts) => {
    const changes = [];
    for (let index = 0; index < 21; index++) {
      const file = `file-${index}.txt`;
      await writeFile(path.join(root, file), `Project file ${index}`);
      changes.push({ path: file, kind: "create" });
    }
    opts.emit({
      type: "tool_call",
      id: "many",
      name: "file_change",
      input: { changes },
      executed: { content: "Created project files" },
    });
    opts.emit({ type: "done", text: "Project files written" });
  };
  const result = await service.execute(
    { instruction: "Write files", outputPaths: ["../private/secret.txt"] },
    ctx,
    artifacts,
  );
  const payload = JSON.parse(result.content);
  expect(payload.limits).toContain("20 caminhos");
  expect(result.isError).toBe(true);
  expect(payload.files).toHaveLength(19);
  expect(result.content).not.toContain("synthetic-secret-not-for-export");
  expect(await readFile(path.join(root, "file-20.txt"), "utf8")).toBe("Project file 20");
});
