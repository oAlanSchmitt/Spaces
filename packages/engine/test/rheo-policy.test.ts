import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  actionHash,
  createToolGateway,
  insertContextItem,
  isSensitive,
  postPersonMessage,
  type ToolContext,
  type ToolSource,
} from "../src";
import { resolveBrain } from "../src/brains/select";
import { consolidateOrg } from "../src/context/consolidate";
import { afterTurnDone, learnRun } from "../src/context/learn";
import { reflectThread } from "../src/context/reflect";
import { ensurePeriodSummary, ensureThreadSummary } from "../src/context/summaries";
import { createRheoToolSource } from "../src/rheo-tools";
import { RHEO_INTERNAL_TOOL, type ToolDefinition } from "../src/tools/types";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(() => f?.close());

async function protectedRun(kind: "control" | "project" = "project") {
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db.insert(schema.rheoWorkspaces).values({
    orgId: f.org.id,
    controlOrgId: f.org.id,
    ownerUserId: f.owner.id,
    kind,
    state: "active",
  });
  const message = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "Use this project." });
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      channelId: f.general.id,
      threadRootId: message.id,
      triggerMessageId: message.id,
      trigger: "mention",
      hop: 1,
    })
    .returning();
  if (!run) throw new Error("Missing test run");
  const ctx: ToolContext = {
    db: f.db,
    orgId: run.orgId,
    agentId: run.agentId,
    runId: run.id,
    channelId: run.channelId,
    threadRootId: run.threadRootId,
    triggerMessageId: run.triggerMessageId,
  };
  return { run, ctx };
}

test("protected runs never discover native or remote tool sources", async () => {
  f = await setup();
  const { ctx } = await protectedRun();
  const source: ToolSource = {
    name: "native",
    async tools() {
      throw new Error("Native tool discovery must not happen");
    },
  };
  expect(await createToolGateway({ sources: [source] }).list(ctx)).toEqual([]);
});

test("a native agent brain edit cannot start a computer in a protected workspace", async () => {
  f = await setup();
  const { run } = await protectedRun();
  await f.db.update(schema.agents).set({ brain: "codex" }).where(eq(schema.agents.id, f.agent.id));
  await expect(resolveBrain({ db: f.db }, f.agent, run, f.general.id)).rejects.toMatchObject({
    code: "rheo.protected_run_required",
  });
});

test("protected turns do not enqueue automatic learning", async () => {
  f = await setup();
  const { run } = await protectedRun();
  expect(await afterTurnDone(f.context, run, { judged: true, signal: "access" })).toBe(false);
  expect((await f.db.select().from(schema.outbox)).filter((job) => job.kind === "context.learn")).toEqual([]);
});

test("already queued native learning and reflection do not read protected content", async () => {
  f = await setup();
  const { run } = await protectedRun();
  expect(await learnRun(f.context, { orgId: run.orgId, runId: run.id })).toMatchObject({ skipped: "rheo_protected" });
  expect(await reflectThread(f.context, { orgId: run.orgId, threadRootId: run.threadRootId })).toMatchObject({
    skipped: "rheo_protected",
  });
  expect(f.provider.calls).toHaveLength(0);
});

function sourceOf(names: string[], trusted = true, connected = false): ToolSource {
  return {
    name: "rheo-test",
    ...(trusted ? { rheoInternal: RHEO_INTERNAL_TOOL } : {}),
    tools: async () =>
      names.map(
        (name): ToolDefinition => ({
          name,
          rheoInternal: RHEO_INTERNAL_TOOL,
          ...(connected ? { connectionId: crypto.randomUUID() } : {}),
          description: name,
          scope: "",
          inputSchema: { type: "object", additionalProperties: false },
          execute: async () => ({ content: "Allowed internal action" }),
        }),
      ),
  };
}

test.each([
  ["control", ["rheo_create_project", "rheo_inspect", "rheo_list"]],
  ["project", ["rheo_context", "rheo_documents", "rheo_inspect", "rheo_memory", "rheo_tasks"]],
] as const)("%s only lists its closed internal allowlist without directory wrappers", async (kind, wanted) => {
  f = await setup();
  const { ctx } = await protectedRun(kind);
  const tools = createToolGateway({
    sources: [
      sourceOf([
        "rheo_list",
        "rheo_create_project",
        "rheo_context",
        "rheo_memory",
        "rheo_documents",
        "rheo_tasks",
        "rheo_inspect",
        "rheo_future_tool",
        "run_code",
      ]),
    ],
  });
  expect((await tools.list({ ...ctx, loadedGroups: [] })).map((tool) => tool.name)).toEqual([...wanted]);
});

test("a remote source cannot spoof the reserved name or internal tool marker", async () => {
  f = await setup();
  const { ctx } = await protectedRun();
  const untrusted = sourceOf(["rheo_context"], false);
  const connected = sourceOf(["rheo_memory"], true, true);
  const tools = createToolGateway({ sources: [untrusted, connected] });
  expect(await tools.list(ctx)).toEqual([]);
});

test("protected direct native calls and use_tool cannot bypass the closed list", async () => {
  f = await setup();
  const { ctx } = await protectedRun();
  const tools = createToolGateway({ sources: [sourceOf(["rheo_context", "run_code", "use_tool"])] });
  for (const name of ["run_code", "use_tool", "rheo_create_project", "rheo_future_tool"]) {
    expect(await tools.invoke(ctx, { name, toolUseId: `call-${name}`, input: {} })).toMatchObject({
      type: "result",
      output: { isError: true, data: { code: "rheo.tool_denied" } },
    });
  }
  expect(await tools.invoke(ctx, { name: "rheo_context", toolUseId: "permitted", input: {} })).toMatchObject({
    type: "result",
    output: { content: "Allowed internal action" },
  });
});

test("archival and a deleted mapping fail closed for gateway and brain selection", async () => {
  f = await setup();
  const { ctx, run } = await protectedRun();
  const tools = createToolGateway({ sources: [sourceOf(["rheo_context"])] });
  await f.db.update(schema.rheoWorkspaces).set({ state: "archived" }).where(eq(schema.rheoWorkspaces.orgId, f.org.id));
  await expect(tools.list(ctx)).rejects.toMatchObject({ code: "rheo.archived" });
  await expect(resolveBrain({ db: f.db }, f.agent, run, f.general.id)).rejects.toMatchObject({ code: "rheo.archived" });
  await f.db.delete(schema.rheoWorkspaces).where(eq(schema.rheoWorkspaces.orgId, f.org.id));
  await expect(tools.list(ctx)).rejects.toMatchObject({ code: "rheo.policy_missing" });
});

test("bridged, background and mismatched runs cannot invoke protected tools", async () => {
  f = await setup();
  const { ctx, run } = await protectedRun();
  const tools = createToolGateway({ sources: [sourceOf(["rheo_context"])] });
  await expect(tools.list({ ...ctx, bridge: { machineId: crypto.randomUUID() } })).rejects.toMatchObject({
    code: "rheo.protected_run_required",
  });
  await expect(tools.list({ ...ctx, triggerMessageId: crypto.randomUUID() })).rejects.toMatchObject({
    code: "rheo.protected_run_required",
  });
  await f.db.update(schema.agentRuns).set({ background: true }).where(eq(schema.agentRuns.id, run.id));
  await expect(resolveBrain({ db: f.db }, f.agent, run, f.general.id)).rejects.toMatchObject({
    code: "rheo.protected_run_required",
  });
});

test("native summaries and consolidation do not transform protected content", async () => {
  f = await setup();
  const { run } = await protectedRun();
  for (let i = 0; i < 2; i++)
    await insertContextItem(f.db, {
      orgId: f.org.id,
      kind: "note",
      scopeType: "agent",
      agentId: f.agent.id,
      content: "A private method that must not enter native automatic memory.",
      channelIds: [f.general.id],
    });
  const before = await f.db.select().from(schema.contextItems);
  expect(await ensureThreadSummary(f.context, f.org.id, run.threadRootId, { force: true })).toBeNull();
  expect(
    await ensurePeriodSummary(
      f.context,
      f.org.id,
      f.general.id,
      {
        from: new Date(0),
        to: new Date(),
      },
      { minMessages: 1 },
    ),
  ).toBeNull();
  await consolidateOrg(f.context, f.org.id);
  expect(await f.db.select().from(schema.contextItems)).toEqual(before);
  expect(f.provider.calls).toHaveLength(0);
});

test("an old approved native action stays blocked, including scheduled approvals", async () => {
  f = await setup();
  const { ctx, run } = await protectedRun();
  const tool = "native_send";
  const [approval] = await f.db
    .insert(schema.approvals)
    .values({
      orgId: f.org.id,
      runId: run.id,
      agentId: f.agent.id,
      channelId: f.general.id,
      threadRootId: run.threadRootId,
      toolUseId: "old-call",
      tool,
      scope: "",
      params: {},
      actionHash: actionHash({ tool, scope: "", connectionId: null, params: {} }),
      title: "Old action",
      ownerUserId: f.owner.id,
      status: "approved",
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  if (!approval) throw new Error("Missing test approval");
  const tools = createToolGateway({ sources: [sourceOf([tool])] });
  for (const runAt of [null, new Date()]) {
    expect(await tools.executeApproved(ctx, { ...approval, runAt })).toMatchObject({
      isError: true,
      data: { code: "rheo.tool_denied" },
    });
  }
  expect((await f.db.select().from(schema.approvals))[0]?.executedAt).toBeNull();
});

test("protected real tools advertise and enforce an owner's always-approve preference", async () => {
  f = await setup();
  const { ctx } = await protectedRun("control");
  await f.db.update(schema.agents).set({ approvalsLevel: "always" }).where(eq(schema.agents.id, f.agent.id));
  const gateway = createToolGateway({ sources: [createRheoToolSource()] });
  const listed = (await gateway.list(ctx)).find((tool) => tool.name === "rheo_create_project");
  expect(listed).toBeDefined();
  if (!listed) throw new Error("Missing listed project tool");
  expect(listed.inputSchema.required).toContain("why");
  expect(isSensitive(listed)).toBe(true);
  const input = { name: "Requires approval", spaceId: crypto.randomUUID() };
  expect(await gateway.invoke(ctx, { name: listed.name, toolUseId: "without-why", input })).toMatchObject({
    type: "result",
    output: { isError: true, data: { code: "tool.why_missing" } },
  });
  expect(
    await gateway.invoke(ctx, {
      name: listed.name,
      toolUseId: "with-why",
      input: {
        ...input,
        why: "The owner asked to create this project in the explicitly chosen space.",
      },
    }),
  ).toMatchObject({ type: "approval" });
  expect(await f.db.select().from(schema.rheoProjects)).toHaveLength(0);
});
