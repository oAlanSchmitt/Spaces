import { afterEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import { systemText } from "@agenteschat/providers";
import {
  addChannelMember,
  createAgent,
  createCredential,
  createFakeJudge,
  createOrganization,
  drainOutbox,
  postPersonMessage,
  recordAudit,
} from "../src";
import { createRheoToolSource } from "../src/rheo-tools";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

test("protected posting refuses archived projects and other members before storing messages", async () => {
  f = await setup();
  const member = await addMember(f.db, f.org.id, "member");
  await addChannelMember(f.db, f.owner.id, f.org.id, f.general.id, { userId: member.id });
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db.insert(schema.rheoWorkspaces).values({
    orgId: f.org.id,
    controlOrgId: f.org.id,
    ownerUserId: f.owner.id,
    kind: "project",
  });
  await expect(
    postPersonMessage(f, member.id, f.org.id, f.general.id, { body: "@dev other member" }),
  ).rejects.toThrow();
  await f.db.update(schema.rheoWorkspaces).set({ state: "archived" }).where(eq(schema.rheoWorkspaces.orgId, f.org.id));
  await expect(postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@dev archived" })).rejects.toThrow();
  const messages = await f.db.select().from(schema.messages).where(eq(schema.messages.orgId, f.org.id));
  expect(messages).toHaveLength(0);
});

test("protected posting does not send a message to the native addressee classifier", async () => {
  f = await setup();
  const qa = await createAgent(
    f.db,
    f.owner.id,
    f.org.id,
    { name: "QA", handle: "qa", role: "Review", instructions: "Review briefly." },
    { model: f.agent.model },
  );
  await addChannelMember(f.db, f.owner.id, f.org.id, f.general.id, { agentId: qa.id });
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db
    .insert(schema.rheoWorkspaces)
    .values({ orgId: f.org.id, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project" });
  const judge = createFakeJudge();
  await postPersonMessage({ db: f.db, pubsub: f.pubsub, judge }, f.owner.id, f.org.id, f.general.id, {
    body: "@dev @qa analisem esta ideia, por favor",
  });
  expect(judge.calls).toHaveLength(0);
});

test("archival between the initial access check and the write refuses a late protected message", async () => {
  f = await setup();
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db
    .insert(schema.rheoWorkspaces)
    .values({ orgId: f.org.id, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project" });
  const guarded = Object.create(f.db) as typeof f.db;
  const transaction = f.db.transaction.bind(f.db);
  Object.defineProperty(guarded, "transaction", {
    value: async (...args: Parameters<typeof f.db.transaction>) => {
      await f.db
        .update(schema.rheoWorkspaces)
        .set({ state: "archived" })
        .where(eq(schema.rheoWorkspaces.orgId, f.org.id));
      return transaction(...args);
    },
  });
  await expect(
    postPersonMessage({ db: guarded, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev late write",
    }),
  ).rejects.toThrow();
  expect(await f.db.select().from(schema.messages).where(eq(schema.messages.orgId, f.org.id))).toHaveLength(0);
  expect(await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, f.org.id))).toHaveLength(0);
});

test("a protected message prepared before archive and reopen cannot become a fresh request", async () => {
  f = await setup();
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db
    .insert(schema.rheoWorkspaces)
    .values({ orgId: f.org.id, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project" });
  const guarded = Object.create(f.db) as typeof f.db;
  const transaction = f.db.transaction.bind(f.db);
  let transactions = 0;
  Object.defineProperty(guarded, "transaction", {
    value: async (...args: Parameters<typeof f.db.transaction>) => {
      if (++transactions === 2) {
        await f.db
          .update(schema.rheoWorkspaces)
          .set({ state: "archived" })
          .where(eq(schema.rheoWorkspaces.orgId, f.org.id));
        await recordAudit(f.db, {
          orgId: f.org.id,
          actor: { type: "person", id: f.owner.id },
          action: "rheo.project_archived",
          target: { type: "project", id: f.org.id },
        });
        await f.db
          .update(schema.rheoWorkspaces)
          .set({ state: "active" })
          .where(eq(schema.rheoWorkspaces.orgId, f.org.id));
      }
      return transaction(...args);
    },
  });
  await expect(
    postPersonMessage({ db: guarded, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev before archive/reopen",
    }),
  ).rejects.toThrow();
  expect(await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, f.org.id))).toHaveLength(0);
});

test("real executor sends only the current project's approved sources to the fake provider", async () => {
  f = await setup({
    reply: () => ({ chunks: ["Pronto."] }),
    contextTools: true,
    toolSources: [createRheoToolSource()],
  });
  const b = await createOrganization(f.db, f.owner.id, { name: "B", context: "GLOBAL_B_DO_NOT_SEND" });
  const credentialB = await createCredential(f.db, f.keyWrapper, f.owner.id, b.organization.id, {
    provider: "anthropic",
    label: "test",
    apiKey: "fake-only-for-test",
  });
  const agentB = await createAgent(
    f.db,
    f.owner.id,
    b.organization.id,
    {
      name: "Dev",
      handle: "dev",
      role: f.agent.role,
      instructions: f.agent.instructions,
      credentialId: credentialB.id,
    },
    { model: f.agent.model },
  );
  await addChannelMember(f.db, f.owner.id, b.organization.id, b.general.id, { agentId: agentB.id });
  for (const orgId of [f.org.id, b.organization.id]) {
    await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, orgId));
    await f.db
      .insert(schema.rheoWorkspaces)
      .values({ orgId, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project" });
  }
  await f.db.insert(schema.rheoEntries).values([
    { orgId: f.org.id, kind: "document", title: "A", body: "ONLY_PROJECT_A", state: "approved" },
    { orgId: b.organization.id, kind: "document", title: "B", body: "ONLY_PROJECT_B", state: "approved" },
    {
      orgId: b.organization.id,
      kind: "document",
      title: "Private",
      body: "OWNER_ONLY_CONTRACT",
      state: "approved",
      visibility: "owner",
    },
  ]);
  await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@dev resume as fontes deste projeto" });
  await drainOutbox(f.db, f.handlers);
  const callsA = f.provider.calls.length;
  expect(callsA).toBeGreaterThan(0);
  await postPersonMessage(f, f.owner.id, b.organization.id, b.general.id, {
    body: "@dev resume as fontes deste projeto",
  });
  await drainOutbox(f.db, f.handlers);
  const callsB = f.provider.calls.slice(callsA);
  expect(callsB.length).toBeGreaterThan(0);
  for (const call of callsB) {
    const prompt = systemText(call.request.system);
    expect(prompt).toContain("ONLY_PROJECT_B");
    expect(prompt).not.toContain("ONLY_PROJECT_A");
    expect(prompt).not.toContain("OWNER_ONLY_CONTRACT");
    expect(prompt).not.toContain("GLOBAL_B_DO_NOT_SEND");
    expect((call.request.tools ?? []).every((tool) => tool.name.startsWith("rheo_"))).toBe(true);
  }
  const runs = await f.db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.orgId, b.organization.id), eq(schema.agentRuns.agentId, agentB.id)));
  expect(runs.some((run) => run.status === "done")).toBe(true);
});
