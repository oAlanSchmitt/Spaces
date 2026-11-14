import { afterEach, expect, test } from "bun:test";
import { createPostgresSearchResolver } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import { bootstrapRheoSpaces, createJobHandlers, insertMessage, postPersonMessage } from "../src";
import * as jobModule from "../src/jobs";
import type { JobHandlers, OutboxJob } from "../src/outbox";
import { indexSource, reindexOrg, searchVisible } from "../src/search";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(() => f?.close());

async function protect() {
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db
    .insert(schema.rheoWorkspaces)
    .values({ orgId: f.org.id, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project", state: "active" });
  await f.db
    .update(schema.agents)
    .set({ handle: "coordenador", brain: "model" })
    .where(eq(schema.agents.id, f.agent.id));
}

async function job(kind: string, payload: Record<string, unknown> = {}): Promise<OutboxJob> {
  const [row] = await f.db.insert(schema.outbox).values({ orgId: f.org.id, kind, payload }).returning();
  if (!row) throw new Error("Missing job fixture");
  return row;
}

test("protected search jobs never reach the native search resolver", async () => {
  f = await setup();
  await protect();
  let called = false;
  const handlers = createJobHandlers({
    ...f.jobDeps,
    search: {
      async forOrg() {
        called = true;
        throw new Error("Private document reached native search");
      },
    },
  });
  await handlers["search.index"]?.(await job("search.index", { kind: "message", sourceId: crypto.randomUUID() }), {
    finalAttempt: false,
  });
  expect(called).toBe(false);
});

test("the closed wrapper blocks future native jobs without opening their payload", async () => {
  f = await setup();
  await protect();
  expect(typeof jobModule.wrapRheoJobHandlers).toBe("function");
  let called = false;
  const native: JobHandlers = {
    "future.native": async () => {
      called = true;
    },
  };
  const handlers = jobModule.wrapRheoJobHandlers(f.db, native);
  const pending = await job("future.native");
  Object.defineProperty(pending, "payload", {
    get() {
      throw new Error("Blocked content read");
    },
  });
  await handlers["future.native"]?.(pending, { finalAttempt: false });
  expect(called).toBe(false);
});

test("legacy jobs retain their native handler and protected policy failures settle without native work", async () => {
  f = await setup();
  let called = 0;
  const handlers = jobModule.wrapRheoJobHandlers(f.db, {
    "future.native": async () => {
      called++;
    },
  });
  await handlers["future.native"]?.(await job("future.native"), { finalAttempt: false });
  expect(called).toBe(1);
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  let failed = false;
  await handlers["future.native"]?.(await job("future.native"), {
    finalAttempt: false,
    failed() {
      failed = true;
    },
  });
  expect(called).toBe(1);
  expect(failed).toBe(true);
});

test("only local message notifications and guarded agent execution keep their native handler", async () => {
  f = await setup();
  await protect();
  const called: string[] = [];
  const kinds = [
    "agent_run.execute",
    "notifications.message",
    "push.send",
    "search.reindex",
    "threads.assess",
    "routine.run",
    "context.reflect",
    "lodi.future",
    "future.native",
  ];
  const handlers = jobModule.wrapRheoJobHandlers(
    f.db,
    Object.fromEntries(
      kinds.map((kind) => [
        kind,
        async () => {
          called.push(kind);
        },
      ]),
    ),
  );
  for (const kind of kinds) await handlers[kind]?.(await job(kind), { finalAttempt: false });
  expect(called).toEqual(["agent_run.execute", "notifications.message"]);
});

test("owner messages dispatch the regular coordinator once without native routing or parked jobs", async () => {
  f = await setup();
  await protect();
  const message = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "Planeia este projeto." });
  const pending = await job("message.posted", { messageId: message.id });
  await f.handlers["message.posted"]?.(pending, { finalAttempt: false });
  await f.handlers["message.posted"]?.(pending, { finalAttempt: false });
  const runs = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, message.id));
  expect(runs).toHaveLength(1);
  expect(runs[0]?.agentId).toBe(f.agent.id);
  expect(runs[0]?.background).toBe(false);
  expect(f.provider.calls).toHaveLength(0);
  expect(
    (await f.db.select().from(schema.outbox)).some((j) => j.kind === "context.reflect" || j.kind.includes("parked")),
  ).toBe(false);
});

test("already-dispatched mentions, agent messages, routine metadata and another person create no extra runs", async () => {
  f = await setup();
  await protect();
  const mention = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@coordenador continua." });
  const before = (await f.db.select().from(schema.agentRuns)).length;
  expect(before).toBe(1);
  await f.handlers["message.posted"]?.(await job("message.posted", { messageId: mention.id }), { finalAttempt: false });
  const other = await addMember(f.db, f.org.id, "member");
  const messages = await f.db.transaction(async (tx) => [
    await insertMessage(tx, {
      orgId: f.org.id,
      channelId: f.general.id,
      author: { type: "agent", agentId: f.agent.id, runId: crypto.randomUUID(), hop: 1 },
      body: "Acorda outra vez.",
    }),
    await insertMessage(tx, {
      orgId: f.org.id,
      channelId: f.general.id,
      author: { type: "person", userId: f.owner.id },
      body: "Rotina",
      meta: { routine: { name: "Automática" } },
    }),
    await insertMessage(tx, {
      orgId: f.org.id,
      channelId: f.general.id,
      author: { type: "person", userId: other.id },
      body: "Acorda.",
    }),
  ]);
  for (const message of messages)
    await f.handlers["message.posted"]?.(await job("message.posted", { messageId: message.id }), {
      finalAttempt: false,
    });
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(before);
});

test("archiving or removing coordinator membership prevents a new dispatch", async () => {
  f = await setup();
  await protect();
  const message = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "Trabalha." });
  await f.db
    .delete(schema.channelMembers)
    .where(and(eq(schema.channelMembers.channelId, f.general.id), eq(schema.channelMembers.agentId, f.agent.id)));
  await f.handlers["message.posted"]?.(await job("message.posted", { messageId: message.id }), { finalAttempt: false });
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(0);
  await f.db.update(schema.rheoWorkspaces).set({ state: "archived" }).where(eq(schema.rheoWorkspaces.orgId, f.org.id));
  let called = false;
  const guarded = jobModule.wrapRheoJobHandlers(f.db, {
    "agent_run.execute": async () => {
      called = true;
    },
  });
  await guarded["agent_run.execute"]?.(await job("agent_run.execute"), { finalAttempt: false });
  expect(called).toBe(false);
});

test("an archived execution job cancels late persisted work without trusting another workspace's run id", async () => {
  f = await setup();
  const other = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "@dev Unrelated workspace" });
  const [unrelated] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, other.id));
  const panel = await bootstrapRheoSpaces(f.db, f.owner.id);
  const project = panel.businesses.flatMap((business) => business.spaces.flatMap((space) => space.projects))[0];
  if (!project || !unrelated) throw new Error("Missing fixture");
  const message = await postPersonMessage(f, f.owner.id, project.orgId, project.channelId, {
    body: "@coordenador Late persisted execution",
  });
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, message.id));
  if (!run) throw new Error("Missing project run");
  await f.db
    .update(schema.rheoWorkspaces)
    .set({ state: "archived" })
    .where(eq(schema.rheoWorkspaces.orgId, project.orgId));
  let nativeCalls = 0;
  const guarded = jobModule.wrapRheoJobHandlers(f.db, {
    "agent_run.execute": async () => {
      nativeCalls++;
    },
    "future.native": async () => {
      nativeCalls++;
    },
  });
  const pending = await job("agent_run.execute", { runId: run.id });
  pending.orgId = project.orgId;
  await guarded["agent_run.execute"]?.(pending, { finalAttempt: false });
  expect((await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id)))[0]?.status).toBe(
    "canceled",
  );
  pending.payload = { runId: unrelated.id };
  await guarded["agent_run.execute"]?.(pending, { finalAttempt: false });
  expect((await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, unrelated.id)))[0]?.status).toBe(
    "queued",
  );
  pending.payload = { runId: "invalid" };
  await guarded["agent_run.execute"]?.(pending, { finalAttempt: false });
  const unknown = { ...pending, kind: "future.native" };
  Object.defineProperty(unknown, "payload", {
    get() {
      throw new Error("Unknown payload must stay closed");
    },
  });
  await guarded["future.native"]?.(unknown, { finalAttempt: false });
  expect(nativeCalls).toBe(0);
});

test("direct native indexing and reindexing cannot read protected documents or call embeddings", async () => {
  f = await setup();
  await protect();
  let called = false;
  const deps = {
    db: f.db,
    search: {
      async forOrg() {
        called = true;
        throw new Error("External index");
      },
    },
    gateway: {
      async embed() {
        called = true;
        throw new Error("External embeddings");
      },
    },
  };
  await indexSource(deps, { orgId: f.org.id, kind: "message", sourceId: crypto.randomUUID() });
  await reindexOrg(deps, f.org.id);
  expect(called).toBe(false);
});

test("protected human search uses the local text index without an external resolver or query embedding", async () => {
  f = await setup();
  await protect();
  const sourceId = crypto.randomUUID();
  const local = await createPostgresSearchResolver(f.db).forOrg(f.org.id);
  await local.upsert([
    {
      orgId: f.org.id,
      kind: "message",
      sourceId,
      channelIds: [f.general.id],
      body: "Aurora confidencial",
      createdAt: new Date(),
    },
  ]);
  let called = false;
  const hits = await searchVisible(
    {
      db: f.db,
      search: {
        async forOrg() {
          called = true;
          throw new Error("External index");
        },
      },
      gateway: {
        async embed() {
          called = true;
          throw new Error("External embeddings");
        },
      },
    },
    { orgId: f.org.id, text: "Aurora", visibleChannelIds: [f.general.id] },
  );
  expect(hits.map((hit) => hit.sourceId)).toEqual([sourceId]);
  expect(called).toBe(false);
});
