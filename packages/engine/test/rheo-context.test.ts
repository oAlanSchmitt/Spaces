import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  bootstrapRheoSpaces,
  buildRunContext,
  createRheoEntry,
  createRheoProject,
  createRheoSpaceEntry,
  insertMessage,
  postPersonMessage,
} from "../src";
import { assertRheoSourcesCurrent } from "../src/rheo-knowledge";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
beforeEach(async () => {
  f = await setup();
});

test("new project contexts include reviewed common sources with their origin and revision while project-only content stays local", async () => {
  const tree = await bootstrapRheoSpaces(f.db, f.owner.id);
  const space = tree.businesses.flatMap((business) => business.spaces).find((candidate) => candidate.projects.length);
  const a = space?.projects[0];
  if (!space || !a) throw new Error("Missing synthetic project");
  const b = await createRheoProject(f.db, f.owner.id, {
    spaceId: space.id,
    name: "Context B",
    requestKey: "context-b",
  });
  const common = await createRheoSpaceEntry(f.db, f.owner.id, space.id, {
    kind: "document",
    title: "Common source",
    body: "COMMON_CONTEXT",
  });
  await createRheoEntry(f.db, f.owner.id, a.orgId, {
    kind: "document",
    title: "Private source",
    body: "ONLY_CONTEXT_A",
  });
  for (const project of [a, b]) {
    const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.orgId, project.orgId));
    if (!agent) throw new Error("Missing project agent");
    const trigger = await postPersonMessage(f, f.owner.id, project.orgId, project.channelId, {
      body: `@${agent.handle} Read our sources`,
    });
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, trigger.id));
    if (!run) throw new Error("Missing project run");
    const context = await buildRunContext(f.db, run, agent, { maxMessages: 20 });
    const rendered = JSON.stringify(context);
    expect(rendered).toContain("COMMON_CONTEXT");
    expect(rendered).toContain(space.id);
    expect(rendered.includes("ONLY_CONTEXT_A")).toBe(project.id === a.id);
    const [receipt] = await f.db
      .select()
      .from(schema.rheoContextReceipts)
      .where(eq(schema.rheoContextReceipts.runId, run.id));
    expect(receipt?.entryIds).toContain(common.id);
    expect(receipt?.entryRevisions[common.id]).toBe(1);
  }
});
afterEach(async () => {
  await f?.close();
});

async function protectFixture() {
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db.insert(schema.rheoWorkspaces).values({
    orgId: f.org.id,
    controlOrgId: f.org.id,
    ownerUserId: f.owner.id,
    kind: "project",
    state: "active",
  });
}

test("protected context excludes organization context and only reads the original conversation", async () => {
  await protectFixture();
  await f.db
    .update(schema.organizations)
    .set({ context: "PRIVATE_GLOBAL_MARKER" })
    .where(eq(schema.organizations.id, f.org.id));
  const message = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: "@dev Start this project",
  });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, message.id));
  if (!run) throw new Error("Expected a run");
  const context = await buildRunContext(f.db, run, f.agent, { maxMessages: 20 });
  expect(JSON.stringify(context)).not.toContain("PRIVATE_GLOBAL_MARKER");
  expect(JSON.stringify(context)).toContain("Start this project");
  expect(context.system.some((block) => block.text.includes("Spaces"))).toBe(true);
});

test("a missing protection mapping never falls back to the legacy context", async () => {
  await protectFixture();
  const message = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: "@dev hello",
  });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, message.id));
  if (!run) throw new Error("Expected a run");
  await f.db.delete(schema.rheoWorkspaces).where(eq(schema.rheoWorkspaces.orgId, f.org.id));
  await expect(buildRunContext(f.db, run, f.agent, { maxMessages: 20 })).rejects.toThrow();
});

test("the context budget counts metadata and receipts only its complete rendered entries", async () => {
  await protectFixture();
  const message = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@dev Read the project" });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, message.id));
  if (!run) throw new Error("Missing run");
  await f.db.insert(schema.rheoEntries).values(
    Array.from({ length: 100 }, () => ({
      orgId: f.org.id,
      kind: "document" as const,
      title: "t".repeat(160),
      body: "b".repeat(300),
      state: "approved" as const,
    })),
  );
  const context = await buildRunContext(f.db, run, f.agent, { maxMessages: 20 });
  const rendered = context.system.map((block) => block.text).join("\n");
  const [receipt] = await f.db
    .select()
    .from(schema.rheoContextReceipts)
    .where(eq(schema.rheoContextReceipts.runId, run.id));
  expect(receipt?.entryIds.every((id) => rendered.includes(id))).toBe(true);
  expect(context.stats.truncated).toBe(true);
});

test("revocation removes derived agent history while preserving human messages in the original channel", async () => {
  await protectFixture();
  const [entry] = await f.db
    .insert(schema.rheoEntries)
    .values({
      orgId: f.org.id,
      kind: "document",
      title: "Approved source",
      body: "REVOKED_SOURCE_MARKER",
      state: "approved",
    })
    .returning();
  if (!entry) throw new Error("Missing test entry");
  const first = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@dev First human request" });
  const [firstRun] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, first.id));
  if (!firstRun) throw new Error("Missing first run");
  expect(JSON.stringify(await buildRunContext(f.db, firstRun, f.agent, { maxMessages: 20 }))).toContain(
    "REVOKED_SOURCE_MARKER",
  );
  const derived = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "agent", agentId: f.agent.id, runId: firstRun.id, hop: 1 },
    body: "DERIVED_REVOKED_MARKER",
  });
  await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "agent", agentId: f.agent.id, runId: null, hop: 1, stretchId: null },
    body: "UNCLASSIFIED_AGENT_MARKER",
  });
  await f.db.update(schema.agentRuns).set({ status: "done" }).where(eq(schema.agentRuns.id, firstRun.id));
  const second = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@dev Second human request" });
  const [secondRun] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.triggerMessageId, second.id));
  if (!secondRun) throw new Error("Missing second run");
  expect(JSON.stringify(await buildRunContext(f.db, secondRun, f.agent, { maxMessages: 20 }))).toContain(
    "DERIVED_REVOKED_MARKER",
  );
  await f.db.update(schema.agentRuns).set({ status: "done" }).where(eq(schema.agentRuns.id, secondRun.id));
  await f.db.update(schema.rheoEntries).set({ state: "archived" }).where(eq(schema.rheoEntries.id, entry.id));
  await expect(assertRheoSourcesCurrent(f.db, f.org.id, firstRun.id)).rejects.toMatchObject({
    code: "rheo.context_revoked",
  });
  const third = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@dev Third human request" });
  const [thirdRun] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, third.id));
  if (!thirdRun) throw new Error("Missing third run");
  const context = JSON.stringify(await buildRunContext(f.db, thirdRun, f.agent, { maxMessages: 20 }));
  expect(context).not.toContain("REVOKED_SOURCE_MARKER");
  expect(context).not.toContain("DERIVED_REVOKED_MARKER");
  expect(context).not.toContain("UNCLASSIFIED_AGENT_MARKER");
  expect(context).toContain("First human request");
  expect(context).toContain("Third human request");
  const [receipt] = await f.db
    .select()
    .from(schema.rheoContextReceipts)
    .where(eq(schema.rheoContextReceipts.runId, thirdRun.id));
  expect(receipt?.messageIds).not.toContain(derived.id);
});
