import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { bootstrapRheoSpaces, createOrganization, createRheoProject, insertMessage, postPersonMessage } from "../src";
import {
  assertRheoSourcesCurrent,
  createRheoEntry,
  createRheoSpaceEntry,
  listRheoEntries,
  listRheoRunEntries,
  recordRheoSources,
  reviewRheoEntry,
  reviewRheoSpaceEntry,
  updateRheoSpaceEntry,
  withRheoPublication,
} from "../src/rheo-knowledge";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
beforeEach(async () => {
  f = await setup();
});

async function sharedSpaceProjects() {
  const tree = await bootstrapRheoSpaces(f.db, f.owner.id);
  const spaces = tree.businesses.flatMap((business) => business.spaces);
  const space = spaces.find((candidate) => candidate.projects.length);
  const otherSpace = spaces.find((candidate) => candidate.id !== space?.id);
  const a = space?.projects[0];
  if (!space || !otherSpace || !a) throw new Error("Missing synthetic scopes");
  const b = await createRheoProject(f.db, f.owner.id, { spaceId: space.id, name: "B", requestKey: "shared-b" });
  const c = await createRheoProject(f.db, f.owner.id, { spaceId: otherSpace.id, name: "C", requestKey: "shared-c" });
  return { tree, space, otherSpace, a, b, c };
}

test("projects A and B inherit only their explicit common space while project C and private sources stay isolated", async () => {
  const { tree, space, otherSpace, a, b, c } = await sharedSpaceProjects();
  const shared = await createRheoSpaceEntry(f.db, f.owner.id, space.id, {
    kind: "document",
    title: "Common",
    body: "COMMON",
  });
  await createRheoSpaceEntry(f.db, f.owner.id, space.id, {
    kind: "document",
    title: "Owner",
    body: "OWNER",
    visibility: "owner",
  });
  const archived = await createRheoSpaceEntry(f.db, f.owner.id, space.id, {
    kind: "document",
    title: "Revoked",
    body: "REVOKED",
  });
  await reviewRheoSpaceEntry(f.db, f.owner.id, space.id, archived.id, "archived");
  await f.db
    .insert(schema.rheoEntries)
    .values({ orgId: shared.orgId, spaceId: space.id, kind: "memory", title: "Pending", body: "PENDING" });
  const local = await createRheoEntry(f.db, f.owner.id, a.orgId, {
    kind: "document",
    title: "A only",
    body: "LOCAL_A",
  });
  expect((await listRheoRunEntries(f.db, a.orgId)).map((entry) => entry.id).sort()).toEqual(
    [shared.id, local.id].sort(),
  );
  expect((await listRheoRunEntries(f.db, b.orgId)).map((entry) => entry.id)).toEqual([shared.id]);
  expect(await listRheoRunEntries(f.db, c.orgId)).toEqual([]);
  expect(await listRheoRunEntries(f.db, tree.controlOrgId as string)).toEqual([]);
  expect(await listRheoRunEntries(f.db, b.orgId, undefined, local.id)).toEqual([]);
  await expect(reviewRheoSpaceEntry(f.db, f.owner.id, otherSpace.id, shared.id, "archived")).rejects.toThrow();
  await expect(reviewRheoEntry(f.db, f.owner.id, shared.orgId, shared.id, "archived")).rejects.toThrow();
});

test("space source revisions revoke held replies and derived project memories even after approval is restored", async () => {
  const { space, a, b } = await sharedSpaceProjects();
  const shared = await createRheoSpaceEntry(f.db, f.owner.id, space.id, {
    kind: "document",
    title: "Common",
    body: "VERSION_ONE",
  });
  const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.orgId, a.orgId));
  if (!agent) throw new Error("Missing project agent");
  const trigger = await postPersonMessage(f, f.owner.id, a.orgId, a.channelId, {
    body: `@${agent.handle} Read common knowledge`,
  });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, trigger.id));
  if (!run) throw new Error("Missing project run");
  const input = { orgId: a.orgId, runId: run.id, channelId: a.channelId, agentId: agent.id };
  await recordRheoSources(f.db, { ...input, entryIds: [shared.id], entryRevisions: { [shared.id]: 1 } });
  const reply = await insertMessage(f.db, {
    orgId: a.orgId,
    channelId: a.channelId,
    author: { type: "agent", agentId: agent.id, runId: run.id, hop: 1 },
    body: "Derived shared answer",
  });
  const [memory] = await f.db
    .insert(schema.rheoEntries)
    .values({
      orgId: a.orgId,
      kind: "memory",
      title: "Derivative",
      body: "DERIVED",
      state: "approved",
      createdByAgentId: agent.id,
      sourceRunId: run.id,
    })
    .returning();
  expect(memory).toBeDefined();
  await assertRheoSourcesCurrent(f.db, a.orgId, run.id);
  const updated = await updateRheoSpaceEntry(f.db, f.owner.id, space.id, shared.id, { body: "VERSION_TWO" });
  expect(updated.revision).toBe(2);
  expect((await listRheoRunEntries(f.db, b.orgId)).map((entry) => entry.body)).toEqual(["VERSION_TWO"]);
  const [otherAgent] = await f.db.select().from(schema.agents).where(eq(schema.agents.orgId, b.orgId));
  if (!otherAgent) throw new Error("Missing neighbouring agent");
  const otherTrigger = await postPersonMessage(f, f.owner.id, b.orgId, b.channelId, {
    body: `@${otherAgent.handle} Read the current source`,
  });
  const [otherRun] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.triggerMessageId, otherTrigger.id));
  if (!otherRun) throw new Error("Missing neighbouring run");
  const otherInput = {
    orgId: b.orgId,
    runId: otherRun.id,
    channelId: b.channelId,
    agentId: otherAgent.id,
    entryIds: [shared.id],
  };
  // A source changed after retrieval cannot be silently receipted as its new revision.
  await expect(recordRheoSources(f.db, { ...otherInput, entryRevisions: { [shared.id]: 1 } })).rejects.toMatchObject({
    code: "rheo.context_revoked",
  });
  await recordRheoSources(f.db, { ...otherInput, entryRevisions: { [shared.id]: 2 } });
  await assertRheoSourcesCurrent(f.db, b.orgId, otherRun.id);
  await expect(
    recordRheoSources(f.db, { ...input, entryIds: [shared.id], entryRevisions: { [shared.id]: 1 } }),
  ).rejects.toMatchObject({ code: "rheo.context_revoked" });
  await expect(withRheoPublication(f.db, a.orgId, run.id, async () => "UNSAFE")).rejects.toMatchObject({
    code: "rheo.context_revoked",
  });
  expect((await listRheoRunEntries(f.db, a.orgId)).map((entry) => entry.id)).not.toContain(memory?.id);
  await reviewRheoSpaceEntry(f.db, f.owner.id, space.id, shared.id, "archived");
  expect(await listRheoRunEntries(f.db, b.orgId)).toEqual([]);
  await reviewRheoSpaceEntry(f.db, f.owner.id, space.id, shared.id, "approved");
  await expect(assertRheoSourcesCurrent(f.db, a.orgId, run.id)).rejects.toMatchObject({ code: "rheo.context_revoked" });
  const { validRheoHistory } = await import("../src/rheo-knowledge");
  expect(await validRheoHistory(f.db, a.orgId, a.channelId, [reply])).toEqual([]);
});

test("receipts refuse a sibling project and another space even under the same owner", async () => {
  const { space, otherSpace, a, b } = await sharedSpaceProjects();
  const shared = await createRheoSpaceEntry(f.db, f.owner.id, space.id, {
    kind: "document",
    title: "Allowed",
    body: "Allowed",
  });
  const foreign = await createRheoSpaceEntry(f.db, f.owner.id, otherSpace.id, {
    kind: "document",
    title: "Other space",
    body: "Denied",
  });
  const sibling = await createRheoEntry(f.db, f.owner.id, a.orgId, {
    kind: "document",
    title: "Sibling",
    body: "Denied",
  });
  const ownerOnly = await createRheoSpaceEntry(f.db, f.owner.id, space.id, {
    kind: "document",
    title: "Owner",
    body: "Denied",
    visibility: "owner",
  });
  const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.orgId, b.orgId));
  if (!agent) throw new Error("Missing project agent");
  const trigger = await postPersonMessage(f, f.owner.id, b.orgId, b.channelId, {
    body: `@${agent.handle} Check boundaries`,
  });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, trigger.id));
  if (!run) throw new Error("Missing project run");
  const input = { orgId: b.orgId, runId: run.id, channelId: b.channelId, agentId: agent.id };
  for (const id of [foreign.id, sibling.id, ownerOnly.id]) {
    await expect(recordRheoSources(f.db, { ...input, entryIds: [id] })).rejects.toMatchObject({
      code: "rheo.context_revoked",
    });
  }
  await expect(recordRheoSources(f.db, { ...input, entryIds: [shared.id] })).rejects.toMatchObject({
    code: "rheo.context_revoked",
  });
  await recordRheoSources(f.db, { ...input, entryIds: [shared.id], entryRevisions: { [shared.id]: 1 } });
  await assertRheoSourcesCurrent(f.db, b.orgId, run.id);
});
afterEach(async () => {
  await f?.close();
});

test("an agent only receives approved project entries, never owner-only or proposed material", async () => {
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db
    .insert(schema.rheoWorkspaces)
    .values({ orgId: f.org.id, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project" });
  await f.db.insert(schema.rheoEntries).values([
    { orgId: f.org.id, kind: "document", title: "Brand", body: "APPROVED_BRAND", state: "approved" },
    {
      orgId: f.org.id,
      kind: "document",
      title: "Contract",
      body: "PRIVATE_CONTRACT",
      state: "approved",
      visibility: "owner",
    },
    { orgId: f.org.id, kind: "memory", title: "Hypothesis", body: "UNREVIEWED", state: "proposed" },
  ]);
  const entries = await listRheoRunEntries(f.db, f.org.id);
  expect(entries.map((entry) => entry.body)).toEqual(["APPROVED_BRAND"]);
});

async function protectedSources() {
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db
    .insert(schema.rheoWorkspaces)
    .values({ orgId: f.org.id, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project" });
  const trigger = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@dev Read this project" });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, trigger.id));
  if (!run) throw new Error("Missing run");
  return { orgId: f.org.id, runId: run.id, channelId: f.general.id, agentId: f.agent.id };
}

test("recent knowledge stays visible and older entries remain reachable by cursor and exact id", async () => {
  await protectedSources();
  const rows = Array.from({ length: 201 }, (_, i) => ({
    id: crypto.randomUUID(),
    orgId: f.org.id,
    kind: "document" as const,
    title: `Document ${i}`,
    body: `Body ${i}`,
    state: "approved" as const,
    createdAt: new Date(1700000000000 + i),
  }));
  await f.db.insert(schema.rheoEntries).values(rows);
  const recent = await listRheoRunEntries(f.db, f.org.id);
  expect(recent[0]?.title).toBe("Document 200");
  const first = await listRheoEntries(f.db, f.owner.id, f.org.id, { limit: 50 });
  expect(first).toHaveLength(50);
  const cursor = first.at(-1)?.id;
  if (!cursor) throw new Error("Missing knowledge cursor");
  await f.db
    .insert(schema.rheoEntries)
    .values({ orgId: f.org.id, kind: "document", title: "Concurrent new document", body: "New", state: "approved" });
  const next = await listRheoEntries(f.db, f.owner.id, f.org.id, { limit: 50, beforeId: cursor });
  expect(next).toHaveLength(50);
  expect(next[0]?.title).toBe("Document 150");
  const oldestId = rows[0]?.id;
  if (!oldestId) throw new Error("Missing oldest document");
  expect((await listRheoRunEntries(f.db, f.org.id, "document", oldestId)).map((entry) => entry.title)).toEqual([
    "Document 0",
  ]);
});

test("receipts reject foreign, owner-only, pending and missing entry ids at the write boundary", async () => {
  const input = await protectedSources();
  const { organization: other, general: otherGeneral } = await createOrganization(f.db, f.owner.id, {
    name: "Other project",
  });
  const entries = await f.db
    .insert(schema.rheoEntries)
    .values([
      { orgId: other.id, kind: "document", title: "Foreign", body: "Other data", state: "approved" },
      {
        orgId: f.org.id,
        kind: "document",
        title: "Private",
        body: "Owner data",
        state: "approved",
        visibility: "owner",
      },
      { orgId: f.org.id, kind: "memory", title: "Pending", body: "Hypothesis", state: "proposed" },
    ])
    .returning();
  for (const id of [...entries.map((entry) => entry.id), crypto.randomUUID()]) {
    await expect(recordRheoSources(f.db, { ...input, entryIds: [id] })).rejects.toThrow();
  }
  const foreignMessage = await insertMessage(f.db, {
    orgId: other.id,
    channelId: otherGeneral.id,
    author: { type: "person", userId: f.owner.id },
    body: "A different project's conversation",
  });
  await expect(recordRheoSources(f.db, { ...input, entryIds: [], messageIds: [foreignMessage.id] })).rejects.toThrow();
  expect(await f.db.select().from(schema.rheoContextReceipts)).toHaveLength(0);
});

test("derived replies and approved agent memories keep their transitive source restrictions", async () => {
  const first = await protectedSources();
  const [source] = await f.db
    .insert(schema.rheoEntries)
    .values({
      orgId: f.org.id,
      kind: "document",
      title: "Source",
      body: "Confidential original",
      state: "approved",
    })
    .returning();
  if (!source) throw new Error("Missing source");
  await recordRheoSources(f.db, { ...first, entryIds: [source.id] });
  const reply = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "agent", agentId: f.agent.id, runId: first.runId, hop: 1 },
    body: "Derived answer",
  });
  await f.db.update(schema.agentRuns).set({ status: "done" }).where(eq(schema.agentRuns.id, first.runId));
  const trigger = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, {
    body: "@dev Continue from that answer",
  });
  const [next] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, trigger.id));
  if (!next) throw new Error("Missing next run");
  await recordRheoSources(f.db, { ...first, runId: next.id, entryIds: [], messageIds: [reply.id] });
  const [receipt] = await f.db
    .select()
    .from(schema.rheoContextReceipts)
    .where(eq(schema.rheoContextReceipts.runId, next.id));
  expect(receipt?.entryIds).toContain(source.id);
  // Old receipts did not flatten inherited entry ids; their message dependencies still apply.
  await f.db
    .update(schema.rheoContextReceipts)
    .set({ entryIds: [] })
    .where(eq(schema.rheoContextReceipts.runId, next.id));
  await f.db.insert(schema.rheoEntries).values({
    orgId: f.org.id,
    kind: "memory",
    title: "Derived memory",
    body: "DERIVED_MEMORY_MARKER",
    state: "approved",
    createdByAgentId: f.agent.id,
    sourceRunId: next.id,
  });
  expect((await listRheoRunEntries(f.db, f.org.id)).some((entry) => entry.body === "DERIVED_MEMORY_MARKER")).toBe(true);
  await f.db.update(schema.rheoEntries).set({ state: "archived" }).where(eq(schema.rheoEntries.id, source.id));
  await expect(assertRheoSourcesCurrent(f.db, f.org.id, next.id)).rejects.toMatchObject({
    code: "rheo.context_revoked",
  });
  expect((await listRheoRunEntries(f.db, f.org.id)).some((entry) => entry.body === "DERIVED_MEMORY_MARKER")).toBe(
    false,
  );
});

test("reading a task created by the same run does not create an artificial provenance cycle", async () => {
  const input = await protectedSources();
  await recordRheoSources(f.db, { ...input, entryIds: [] });
  const [task] = await f.db
    .insert(schema.rheoEntries)
    .values({
      orgId: f.org.id,
      kind: "task",
      title: "Own task",
      body: "Current work",
      state: "approved",
      createdByAgentId: f.agent.id,
      sourceRunId: input.runId,
    })
    .returning();
  if (!task) throw new Error("Missing task");
  await recordRheoSources(f.db, { ...input, entryIds: [task.id] });
  await assertRheoSourcesCurrent(f.db, f.org.id, input.runId);
  expect((await listRheoRunEntries(f.db, f.org.id)).map((entry) => entry.id)).toContain(task.id);
  await f.db.update(schema.rheoEntries).set({ state: "archived" }).where(eq(schema.rheoEntries.id, task.id));
  await expect(assertRheoSourcesCurrent(f.db, f.org.id, input.runId)).rejects.toMatchObject({
    code: "rheo.context_revoked",
  });
});

test("protected publication rolls back its writes and refuses sources revoked before publication", async () => {
  const input = await protectedSources();
  const [source] = await f.db
    .insert(schema.rheoEntries)
    .values({
      orgId: f.org.id,
      kind: "document",
      title: "Publication source",
      body: "Reviewed",
      state: "approved",
    })
    .returning();
  if (!source) throw new Error("Missing source");
  await recordRheoSources(f.db, { ...input, entryIds: [source.id] });
  await expect(
    withRheoPublication(f.db, f.org.id, input.runId, async (tx) => {
      expect(tx).not.toBe(f.db);
      await insertMessage(tx, {
        orgId: f.org.id,
        channelId: f.general.id,
        author: { type: "agent", agentId: f.agent.id, runId: input.runId, hop: 1 },
        body: "MUST_ROLL_BACK",
      });
      throw new Error("Publication failed");
    }),
  ).rejects.toThrow("Publication failed");
  expect(await f.db.select().from(schema.messages).where(eq(schema.messages.body, "MUST_ROLL_BACK"))).toHaveLength(0);
  await reviewRheoEntry(f.db, f.owner.id, f.org.id, source.id, "archived");
  let published = false;
  await expect(
    withRheoPublication(f.db, f.org.id, input.runId, async () => {
      published = true;
    }),
  ).rejects.toMatchObject({ code: "rheo.context_revoked" });
  expect(published).toBe(false);
});

test("archived publication is refused and legacy callbacks keep their existing executor", async () => {
  expect(await withRheoPublication(f.db, f.org.id, crypto.randomUUID(), async (tx) => tx === f.db)).toBe(true);
  const input = await protectedSources();
  await f.db.update(schema.rheoWorkspaces).set({ state: "archived" }).where(eq(schema.rheoWorkspaces.orgId, f.org.id));
  let published = false;
  await expect(
    withRheoPublication(f.db, f.org.id, input.runId, async () => {
      published = true;
    }),
  ).rejects.toThrow();
  expect(published).toBe(false);
});
