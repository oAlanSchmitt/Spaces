import { afterEach, expect, test } from "bun:test";
import { and, eq, schema, sql } from "@agenteschat/db";
import { createTestDatabase } from "@agenteschat/db/testing";
import * as engine from "../src";
import { addUser, setup } from "./fixtures";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

test("Rheo exposes protected provisioning rather than a task-board label", () => {
  expect(typeof engine.bootstrapRheoSpaces).toBe("function");
  expect(typeof engine.createRheoProject).toBe("function");
});

test("business and space duplicates return validation errors regardless of letter case", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  const owner = await addUser(fixture.db, "Alan");
  await engine.bootstrapRheoSpaces(fixture.db, owner.id);
  const business = await engine.createRheoBusiness(fixture.db, owner.id, { name: "Clientes" });
  for (const name of ["Clientes", "clientes", "CLIENTES"])
    await expect(engine.createRheoBusiness(fixture.db, owner.id, { name })).rejects.toBeInstanceOf(
      engine.ValidationError,
    );
  await engine.createRheoSpace(fixture.db, owner.id, { businessId: business.id, name: "Construção" });
  for (const name of ["Construção", "construção", "CONSTRUÇÃO"])
    await expect(
      engine.createRheoSpace(fixture.db, owner.id, { businessId: business.id, name }),
    ).rejects.toBeInstanceOf(engine.ValidationError);
});

test("bootstrap is idempotent and creates protected workspaces without copying credentials", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  const { db } = fixture;
  const owner = await addUser(db, "Alan");
  const first = await engine.bootstrapRheoSpaces(db, owner.id);
  const again = await engine.bootstrapRheoSpaces(db, owner.id);
  expect(again.controlOrgId).toBe(first.controlOrgId);
  expect(first.businesses.map((b) => b.name).sort()).toEqual(["Pessoal", "Profissional"]);
  expect(first.templates).toHaveLength(1);
  const organizations = await db.select().from(schema.organizations);
  expect(organizations.length).toBeGreaterThan(1);
  expect(organizations.every((o) => o.rheoProtected)).toBe(true);
  const mappings = await db.select().from(schema.rheoWorkspaces);
  expect(mappings).toHaveLength(organizations.length);
  expect(mappings.every((m) => m.ownerUserId === owner.id && m.state === "active")).toBe(true);
  expect(await db.select().from(schema.providerCredentials)).toHaveLength(0);
  expect(await db.select().from(schema.machines)).toHaveLength(0);
  expect(await db.select().from(schema.routines)).toHaveLength(0);
});

test("a failure after native provisioning rolls the project organization and mapping back", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  const { db } = fixture;
  const owner = await addUser(db, "Alan");
  const tree = await engine.bootstrapRheoSpaces(db, owner.id);
  const before = await db.select({ id: schema.organizations.id }).from(schema.organizations);
  await db.execute(
    sql.raw(
      "CREATE FUNCTION rheo_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test project failure'; END $$",
    ),
  );
  await db.execute(
    sql.raw(
      "CREATE TRIGGER rheo_test_failure BEFORE INSERT ON rheo_projects FOR EACH ROW EXECUTE FUNCTION rheo_test_failure()",
    ),
  );
  await expect(
    engine.createRheoProject(db, owner.id, {
      spaceId: tree.businesses[0]!.spaces[0]!.id,
      name: "Rollback",
      requestKey: "rollback",
    }),
  ).rejects.toThrow();
  expect(await db.select({ id: schema.organizations.id }).from(schema.organizations)).toEqual(before);
  expect(await db.select().from(schema.rheoWorkspaces)).toHaveLength(before.length);
});

test("new projects have separate native organizations and an idempotency key cannot change its request", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  const { db } = fixture;
  const owner = await addUser(db, "Alan");
  const tree = await engine.bootstrapRheoSpaces(db, owner.id);
  const spaceId = tree.businesses[0]!.spaces[0]!.id;
  const a = await engine.createRheoProject(db, owner.id, { spaceId, name: "Aurora", requestKey: "aurora-1" });
  const same = await engine.createRheoProject(db, owner.id, { spaceId, name: "Aurora", requestKey: "aurora-1" });
  const b = await engine.createRheoProject(db, owner.id, { spaceId, name: "Boreal", requestKey: "boreal-1" });
  expect(same).toEqual(a);
  expect(a.orgId).not.toBe(b.orgId);
  expect(a.channelId).not.toBe(b.channelId);
  const channels = await db.select().from(schema.channels).where(eq(schema.channels.id, a.channelId));
  expect(channels[0]?.orgId).toBe(a.orgId);
  await expect(
    engine.createRheoProject(db, owner.id, { spaceId, name: "Changed", requestKey: "aurora-1" }),
  ).rejects.toBeInstanceOf(engine.ValidationError);
});

test("another person cannot read or create within the owner's control workspace", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  const { db } = fixture;
  const owner = await addUser(db, "Alan");
  const other = await addUser(db, "Outra");
  const tree = await engine.bootstrapRheoSpaces(db, owner.id);
  expect((await engine.listRheoSpaces(db, other.id)).controlOrgId).toBeNull();
  await expect(
    engine.createRheoSpace(db, other.id, { businessId: tree.businesses[0]!.id, name: "Denied" }),
  ).rejects.toBeInstanceOf(engine.ForbiddenError);
  await expect(
    engine.createRheoProject(db, other.id, {
      spaceId: tree.businesses[0]!.spaces[0]!.id,
      name: "Denied",
      requestKey: "denied",
    }),
  ).rejects.toBeInstanceOf(engine.ForbiddenError);
});

test("archiving updates the durable execution mapping and project channel", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  const { db } = fixture;
  const owner = await addUser(db, "Alan");
  const tree = await engine.bootstrapRheoSpaces(db, owner.id);
  const project = await engine.createRheoProject(db, owner.id, {
    spaceId: tree.businesses[0]!.spaces[0]!.id,
    name: "Site",
    requestKey: "site",
  });
  await engine.setRheoProjectState(db, owner.id, project.id, "archived");
  const [mapping] = await db.select().from(schema.rheoWorkspaces).where(eq(schema.rheoWorkspaces.orgId, project.orgId));
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.id, project.channelId), eq(schema.channels.orgId, project.orgId)));
  expect(mapping?.state).toBe("archived");
  expect(channel?.archivedAt).not.toBeNull();
  await engine.setRheoProjectState(db, owner.id, project.id, "active");
  expect(
    (await db.select().from(schema.rheoWorkspaces).where(eq(schema.rheoWorkspaces.orgId, project.orgId)))[0]?.state,
  ).toBe("active");
});

test("archiving cancels queued project work, aborts it locally and never revives it on reopen", async () => {
  const f = await setup();
  close = f.close;
  const tree = await engine.bootstrapRheoSpaces(f.db, f.owner.id);
  const project = tree.businesses.flatMap((business) => business.spaces.flatMap((space) => space.projects))[0];
  if (!project) throw new Error("Missing project");
  const original = await engine.postPersonMessage(f, f.owner.id, f.org.id, f.general.id, {
    body: "@dev Other workspace",
  });
  const message = await engine.postPersonMessage(f, f.owner.id, project.orgId, project.channelId, {
    body: "@coordenador Archive this synthetic request",
  });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, message.id));
  const [other] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, original.id));
  if (!run || !other) throw new Error("Missing run");
  const controller = engine.registerRunAbort(run.id);
  const otherController = engine.registerRunAbort(other.id);
  try {
    await engine.setRheoProjectState(f.db, f.owner.id, project.id, "archived");
    const [stopped] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
    expect(stopped?.status).toBe("canceled");
    expect(stopped?.finishedAt).not.toBeNull();
    expect(controller.signal.aborted).toBe(true);
    expect(otherController.signal.aborted).toBe(false);
    expect((await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, other.id)))[0]?.status).toBe(
      "queued",
    );
    await engine.setRheoProjectState(f.db, f.owner.id, project.id, "active");
    await engine.drainOutbox(f.db, f.handlers);
    expect((await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id)))[0]?.status).toBe(
      "canceled",
    );
    const next = await engine.postPersonMessage(f, f.owner.id, project.orgId, project.channelId, {
      body: "@coordenador A new request after reopen",
    });
    const [fresh] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, next.id));
    expect(fresh?.status).toBe("queued");
    expect(fresh?.id).not.toBe(run.id);
    if (!fresh) throw new Error("Missing reopened run");
    await f.db
      .update(schema.agentRuns)
      .set({ status: "done", pendingMessageIds: [next.id], finishedAt: new Date() })
      .where(eq(schema.agentRuns.id, fresh.id));
    await engine.setRheoProjectState(f.db, f.owner.id, project.id, "archived");
    await engine.setRheoProjectState(f.db, f.owner.id, project.id, "active");
    await engine.sweepEndedInboxes({ db: f.db }, { now: new Date(Date.now() + 60_000), graceMs: 0 });
    expect(
      (await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, fresh.id)))[0]?.pendingMessageIds,
    ).toEqual([]);
    expect(
      await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, next.id)),
    ).toHaveLength(1);
  } finally {
    engine.unregisterRunAbort(run.id, controller);
    engine.unregisterRunAbort(other.id, otherController);
  }
});

test("an inbox already taken before archive cannot hand work on after reopening", async () => {
  const f = await setup();
  close = f.close;
  const tree = await engine.bootstrapRheoSpaces(f.db, f.owner.id);
  const project = tree.businesses.flatMap((business) => business.spaces.flatMap((space) => space.projects))[0];
  if (!project) throw new Error("Missing project");
  const credential = await engine.createCredential(f.db, f.keyWrapper, f.owner.id, project.orgId, {
    provider: "anthropic",
    label: "Synthetic only",
    apiKey: "fake-audit-only",
  });
  await f.db
    .update(schema.agents)
    .set({ model: f.agent.model, credentialId: credential.id })
    .where(eq(schema.agents.orgId, project.orgId));
  const message = await engine.postPersonMessage(f, f.owner.id, project.orgId, project.channelId, {
    body: "@coordenador Pending before archive",
  });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, message.id));
  if (!run) throw new Error("Missing run");
  const pending = await engine.insertMessage(f.db, {
    orgId: project.orgId,
    channelId: project.channelId,
    author: { type: "person", userId: f.owner.id },
    body: "Synthetic unread follow-up",
  });
  await f.db
    .update(schema.agentRuns)
    .set({ status: "done", pendingMessageIds: [pending.id], finishedAt: new Date() })
    .where(eq(schema.agentRuns.id, run.id));
  let taken = false;
  const db = new Proxy(f.db, {
    get(target, key) {
      if (key === "transaction")
        return async (...args: Parameters<typeof f.db.transaction>) => {
          const result = await target.transaction(...args);
          if (!taken) {
            taken = true;
            await engine.setRheoProjectState(f.db, f.owner.id, project.id, "archived");
            await engine.setRheoProjectState(f.db, f.owner.id, project.id, "active");
          }
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  expect(await engine.releaseInbox(db, f.pubsub, run, { reason: "swept" })).toBeNull();
  expect(
    await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, pending.id)),
  ).toHaveLength(0);
});

test("reopening waits for pre-archive cancellation before accepting new work", async () => {
  const f = await setup();
  close = f.close;
  const tree = await engine.bootstrapRheoSpaces(f.db, f.owner.id);
  const project = tree.businesses.flatMap((business) => business.spaces.flatMap((space) => space.projects))[0];
  if (!project) throw new Error("Missing project");
  await engine.postPersonMessage(f, f.owner.id, project.orgId, project.channelId, {
    body: "@coordenador Original work",
  });
  let committed!: () => void;
  let continueCancel!: () => void;
  const archived = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    continueCancel = resolve;
  });
  const db = new Proxy(f.db, {
    get(target, key) {
      if (key === "transaction")
        return async (...args: Parameters<typeof f.db.transaction>) => {
          const result = await target.transaction(...args);
          committed();
          await wait;
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const closing = engine.setRheoProjectState(db, f.owner.id, project.id, "archived");
  await archived;
  try {
    await expect(engine.setRheoProjectState(f.db, f.owner.id, project.id, "active")).rejects.toBeInstanceOf(
      engine.ConflictError,
    );
    expect(
      (await f.db.select().from(schema.rheoWorkspaces).where(eq(schema.rheoWorkspaces.orgId, project.orgId)))[0]?.state,
    ).toBe("archived");
  } finally {
    continueCancel();
    await closing;
  }
  expect((await engine.setRheoProjectState(f.db, f.owner.id, project.id, "active")).state).toBe("active");
});
