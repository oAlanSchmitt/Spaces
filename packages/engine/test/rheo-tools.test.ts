import { afterEach, beforeEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  assertRheoSourcesCurrent,
  bootstrapRheoSpaces,
  createToolGateway,
  postPersonMessage,
  reviewRheoEntry,
  setMessageLinkBase,
  type ToolContext,
} from "../src";
import { createRheoToolSource } from "../src/rheo-tools";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
beforeEach(async () => {
  f = await setup();
});
afterEach(async () => {
  setMessageLinkBase("http://localhost:3000");
  await f?.close();
});

async function globalContext() {
  const overview = await bootstrapRheoSpaces(f.db, f.owner.id);
  const orgId = overview.controlOrgId;
  const channelId = overview.controlChannelId;
  if (!orgId || !channelId) throw new Error("Missing control workspace");
  const [agent] = await f.db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.handle, "coordenador")));
  if (!agent) throw new Error("Missing coordinator");
  const message = await postPersonMessage(f, f.owner.id, orgId, channelId, {
    body: "@coordenador Cria um novo projeto",
  });
  const [run] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.orgId, orgId),
        eq(schema.agentRuns.triggerMessageId, message.id),
        eq(schema.agentRuns.agentId, agent.id),
      ),
    );
  if (!run) throw new Error("Missing coordinator run");
  const ctx: ToolContext = {
    db: f.db,
    orgId,
    channelId,
    agentId: agent.id,
    runId: run.id,
    threadRootId: run.threadRootId,
    triggerMessageId: message.id,
  };
  return { overview, ctx };
}

test("the global coordinator creates a project idempotently without changing the current scope", async () => {
  setMessageLinkBase("http://localhost:4410");
  const { overview, ctx } = await globalContext();
  const gateway = createToolGateway({ sources: [createRheoToolSource()] });
  const input = { spaceId: overview.businesses[0]!.spaces[0]!.id, name: "Novo projeto" };
  const original = JSON.stringify({ orgId: ctx.orgId, channelId: ctx.channelId, runId: ctx.runId });
  const first = await gateway.invoke(ctx, { toolUseId: "create-1", name: "rheo_create_project", input });
  const second = await gateway.invoke(ctx, { toolUseId: "create-2", name: "rheo_create_project", input });
  expect(first.type).toBe("result");
  expect(second.type).toBe("result");
  if (first.type === "result" && first.output.isError) throw new Error(first.output.content);
  if (first.type === "result") expect(JSON.parse(first.output.content).path).toStartWith("http://localhost:4410/org/");
  const projects = await f.db
    .select()
    .from(schema.rheoProjects)
    .where(and(eq(schema.rheoProjects.orgId, ctx.orgId), eq(schema.rheoProjects.name, input.name)));
  expect(projects).toHaveLength(1);
  expect(projects[0]!.nativeOrgId).not.toBe(ctx.orgId);
  expect(JSON.stringify({ orgId: ctx.orgId, channelId: ctx.channelId, runId: ctx.runId })).toBe(original);
});

test("model-supplied ownership is rejected by the protected tool schema", async () => {
  const { overview, ctx } = await globalContext();
  const gateway = createToolGateway({ sources: [createRheoToolSource()] });
  const result = await gateway.invoke(ctx, {
    toolUseId: "forged",
    name: "rheo_create_project",
    input: {
      spaceId: overview.businesses[0]!.spaces[0]!.id,
      name: "Forged",
      ownerUserId: "another-person",
    },
  });
  expect(result.type).toBe("result");
  if (result.type === "result") expect(result.output.isError).toBe(true);
  expect(await f.db.select().from(schema.rheoProjects).where(eq(schema.rheoProjects.name, "Forged"))).toHaveLength(0);
});

test("tool output stays valid JSON and receipts only include the entries actually rendered", async () => {
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db
    .insert(schema.rheoWorkspaces)
    .values({ orgId: f.org.id, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project" });
  const message = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, {
    body: "@dev Read project documents",
  });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, message.id));
  if (!run) throw new Error("Missing run");
  const rows = await f.db
    .insert(schema.rheoEntries)
    .values(
      [0, 1, 2].map((i) => ({
        orgId: f.org.id,
        kind: "document" as const,
        title: `Document ${i}`,
        body: "x".repeat(30_000),
        state: "approved" as const,
      })),
    )
    .returning();
  const ctx: ToolContext = {
    db: f.db,
    orgId: f.org.id,
    channelId: f.general.id,
    agentId: f.agent.id,
    runId: run.id,
    threadRootId: run.threadRootId,
    triggerMessageId: message.id,
  };
  const tool = (await createRheoToolSource().tools(ctx)).find((item) => item.name === "rheo_documents");
  if (!tool) throw new Error("Missing documents tool");
  const output = await tool.execute({}, ctx);
  const payload = JSON.parse(output.content.split("\n").slice(1, -1).join("\n")) as {
    entries: { id: string; body: string; truncated?: boolean }[];
    omittedCount: number;
  };
  expect(output.content.length).toBeLessThan(40_100);
  expect(payload.omittedCount).toBe(2);
  const [receipt] = await f.db
    .select()
    .from(schema.rheoContextReceipts)
    .where(eq(schema.rheoContextReceipts.runId, run.id));
  expect(receipt?.entryIds).toEqual(payload.entries.map((entry) => entry.id));
  const omitted = rows.find((row) => !payload.entries.some((entry) => entry.id === row.id));
  if (!omitted) throw new Error("Missing omitted source");
  await reviewRheoEntry(f.db, f.owner.id, f.org.id, omitted.id, "archived");
  await assertRheoSourcesCurrent(f.db, f.org.id, run.id);
  const large = await f.db
    .insert(schema.rheoEntries)
    .values({ orgId: f.org.id, kind: "document", title: "Escaped", body: '"\\'.repeat(20_000), state: "approved" })
    .returning();
  const id = large[0]?.id;
  if (!id) throw new Error("Missing large document");
  const largeOutput = await tool.execute({ id }, ctx);
  const largePayload = JSON.parse(largeOutput.content.split("\n").slice(1, -1).join("\n")) as typeof payload;
  expect(largePayload.entries[0]?.truncated).toBe(true);
  expect(largeOutput.content.length).toBeLessThan(40_100);
});
