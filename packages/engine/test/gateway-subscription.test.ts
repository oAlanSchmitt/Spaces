import { afterEach, expect, test } from "bun:test";
import { noPlatformCredentials } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import type { ModelResult } from "@agenteschat/providers";
import { BudgetExceededError as BudgetError, MissingCredentialError } from "../src/errors";
import { createModelGateway, type SubscriptionModel } from "../src/gateway";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(() => f?.close());
const reply: ModelResult = {
  text: "hello",
  content: [{ type: "text", text: "hello" }],
  model: "codex-subscription",
  stopReason: "end_turn",
  usage: { inputTokens: 9, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
};
function gateway(subscription: SubscriptionModel) {
  return createModelGateway({
    db: f.db,
    keyWrappers: [f.keyWrapper],
    providers: { anthropic: f.provider },
    platformCredentials: noPlatformCredentials,
    subscription,
  });
}
function call(g: ReturnType<typeof gateway>) {
  return g.stream({
    orgId: f.org.id,
    agentId: f.agent.id,
    system: "sys",
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 100,
    onDelta() {},
  });
}

test("subscription bypasses API credentials and records real tokens at zero incremental cost", async () => {
  f = await setup();
  const g = gateway({ handles: async () => true, available: async () => true, stream: async () => reply });
  expect(await g.hasModelCredential(f.agent)).toBe(true);
  const result = await call(g);
  expect(result.costNanoUsd).toBe(0);
  expect(f.provider.calls).toHaveLength(0);
  const [usage] = await f.db.select().from(schema.usageRecords);
  expect(usage).toMatchObject({
    provider: "codex-subscription",
    credentialId: null,
    inputTokens: 9,
    outputTokens: 2,
    costNanoUsd: 0,
  });
  expect(await f.db.select().from(schema.budgetReservations)).toHaveLength(0);
});

test("offline subscription never falls back to an existing API key or an auxiliary API call", async () => {
  f = await setup();
  let invoked = false;
  const g = gateway({
    handles: async () => true,
    available: async () => false,
    stream: async () => {
      invoked = true;
      return reply;
    },
  });
  expect(await g.hasModelCredential(f.agent)).toBe(false);
  await expect(call(g)).rejects.toBeInstanceOf(MissingCredentialError);
  await expect(
    g.complete({ orgId: f.org.id, kind: "summary", model: f.agent.model, system: "s", messages: [], maxTokens: 10 }),
  ).rejects.toThrow();
  expect(await g.embed({ orgId: f.org.id, texts: ["private"], inputType: "query" })).toBeNull();
  expect((await g.verifyKey({ orgId: f.org.id, provider: "anthropic", key: { apiKey: "sk-no" } })).state).toBe(
    "unchecked",
  );
  expect(invoked).toBe(false);
  expect(f.provider.calls).toHaveLength(0);
});

test("subscription respects an already exhausted budget", async () => {
  f = await setup({ budgetNanoUsd: 0 });
  let invoked = false;
  const g = gateway({
    handles: async () => true,
    available: async () => true,
    stream: async () => {
      invoked = true;
      return reply;
    },
  });
  await expect(call(g)).rejects.toBeInstanceOf(BudgetError);
  expect(invoked).toBe(false);
});

test("a subscription response is refused if the agent is archived while it runs", async () => {
  f = await setup();
  const g = gateway({
    handles: async () => true,
    available: async () => true,
    stream: async () => {
      await f.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, f.agent.id));
      return reply;
    },
  });
  await expect(call(g)).rejects.toThrow();
  expect(f.provider.calls).toHaveLength(0);
});

test("subscription deltas stay private when workspace authority is revoked during the call", async () => {
  f = await setup();
  let active = true;
  const deltas: string[] = [];
  const g = gateway({
    handles: async () => true,
    available: async () => active,
    stream: async (call) => {
      call.onDelta("must not escape");
      active = false;
      return reply;
    },
  });
  await expect(
    g.stream({
      orgId: f.org.id,
      agentId: f.agent.id,
      system: "sys",
      messages: [],
      maxTokens: 100,
      onDelta: (text) => deltas.push(text),
    }),
  ).rejects.toThrow();
  expect(deltas).toEqual([]);
});

test("legacy organizations continue using the registered provider", async () => {
  f = await setup();
  const g = gateway({
    handles: async () => false,
    available: async () => false,
    stream: async () => {
      throw new Error("must not run");
    },
  });
  await call(g);
  expect(f.provider.calls).toHaveLength(1);
});
