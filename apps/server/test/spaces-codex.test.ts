import { afterEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, schema } from "@agenteschat/db";
import { createTestDatabase } from "@agenteschat/db/testing";
import { bootstrapRheoSpaces, type GatewayCall, postPersonMessage } from "@agenteschat/engine";
import { setup } from "../../../packages/engine/test/fixtures";
import { createApp } from "../src/app";
import {
  createSpacesCodex,
  runSpacesCodexTurn,
  type SpacesCodexRpc,
  sha256File,
  spacesCodexLaunch,
} from "../src/spaces-codex";
import { browser, createTestServer, signUp } from "./harness";

test("executable hashing reads every chunk and checks fresh bytes without retaining the whole file", async () => {
  const file = path.join(os.tmpdir(), `spaces-hash-${randomUUID()}.bin`);
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 31);
  await writeFile(file, bytes);
  try {
    const first = await sha256File(file);
    expect(first).toBe(createHash("sha256").update(bytes).digest("hex"));
    bytes[bytes.length - 1] = 47;
    await writeFile(file, bytes);
    expect(await sha256File(file)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(await sha256File(file)).not.toBe(first);
  } finally {
    await unlink(file);
  }
  await expect(sha256File(file)).rejects.toThrow();
});

class FakeRpc implements SpacesCodexRpc {
  calls: { method: string; params: unknown }[] = [];
  listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  account: unknown = { type: "chatgpt", email: "not-returned@example.com", planType: "plus" };
  login: unknown = {
    type: "chatgpt",
    authUrl: "https://auth.openai.com/authorize?state=test",
    loginId: "private-login-id",
  };
  dangerous = false;
  notifications: { method: string; params: Record<string, unknown> }[] = [];
  nativeRequest = false;
  output = JSON.stringify({ text: "Olá", toolCalls: [{ name: "rheo_list", input: "{}" }] });
  requestHandler: unknown;
  closed = false;
  onTurn?: () => Promise<void>;
  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    if (method === "account/read") return { account: this.account } as T;
    if (method === "account/login/start") return this.login as T;
    if (method === "thread/start") return { thread: { id: "thread-new" } } as T;
    if (method === "turn/start") {
      await this.onTurn?.();
      queueMicrotask(() => {
        for (const notification of this.notifications) this.emit(notification.method, notification.params);
        if (this.nativeRequest && typeof this.requestHandler === "function")
          this.requestHandler("item/commandExecution/requestApproval", {
            threadId: "thread-new",
            command: "secret-command",
          });
        if (this.dangerous)
          this.emit("item/started", { threadId: "thread-new", turnId: "turn-new", item: { type: "commandExecution" } });
        this.emit("item/agentMessage/delta", { threadId: "thread-new", turnId: "turn-new", delta: this.output });
        this.emit("thread/tokenUsage/updated", {
          threadId: "thread-new",
          turnId: "turn-new",
          tokenUsage: { total: { inputTokens: 31, outputTokens: 12, cachedInputTokens: 2, cacheWriteInputTokens: 0 } },
        });
        this.emit("turn/completed", {
          threadId: "thread-new",
          turn: { id: "turn-new", status: "completed", error: null },
        });
      });
      return { turn: { id: "turn-new" } } as T;
    }
    return {} as T;
  }
  emit(method: string, params: Record<string, unknown>) {
    for (const l of this.listeners) l(method, params);
  }
  notify() {}
  onNotification(listener: (method: string, params: Record<string, unknown>) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onRequest(handler: unknown) {
    this.requestHandler = handler;
  }
  close() {
    this.closed = true;
  }
}
const call: GatewayCall = {
  orgId: "project",
  agentId: "coordinator",
  system: "Only this project",
  messages: [{ role: "user", content: "Olá" }],
  tools: [
    { name: "rheo_list", description: "List projects", inputSchema: { type: "object", additionalProperties: false } },
  ],
  maxTokens: 100,
  onDelta() {},
};

test("launch has a dedicated home, named read profile and no inherited API keys or legacy sandbox", () => {
  const launch = spacesCodexLaunch({
    home: "C:\\spaces\\codex",
    workspace: "C:\\spaces\\codex\\workspace",
    env: { PATH: "safe", OPENAI_API_KEY: "secret", CODEX_HOME: "personal", HOME: "personal" },
  });
  expect(launch.env.OPENAI_API_KEY).toBeUndefined();
  expect(launch.env.CODEX_HOME).toBe("C:\\spaces\\codex");
  expect(launch.env.HOME).toBe("C:\\spaces\\codex");
  expect(launch.args).toContain('default_permissions="spaces-closed"');
  expect(launch.args.join(" ")).not.toContain("sandboxPolicy");
  expect(launch.args.join(" ")).not.toContain("--sandbox");
  expect(launch.args.join(" ")).toContain('windows.sandbox="mxc"');
  expect(launch.args).toContain("agents.enabled=false");
  expect(launch.args).toContain("features.code_mode.direct_only_tool_namespaces=[]");
});

(process.platform === "win32" ? test : test.skip)("Windows launch is unchanged by an ephemeral harness PATH", () => {
  const input = { home: "C:\\spaces\\codex", workspace: "C:\\spaces\\codex\\workspace" };
  const first = spacesCodexLaunch({ ...input, env: { SystemRoot: "C:\\Windows", PATH: "C:\\temporary-harness-A" } });
  const next = spacesCodexLaunch({ ...input, env: { SystemRoot: "C:\\Windows", PATH: "C:\\temporary-harness-B" } });
  expect(first).toEqual(next);
  expect(first.env.PATH).toBe("C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0");
});

test("subscription uses an ephemeral thread, proposes validated internal tools and records measured tokens", async () => {
  const rpc = new FakeRpc();
  const result = await runSpacesCodexTurn(rpc, call, { workspace: "C:\\synthetic" });
  expect(result).toMatchObject({
    text: "Olá",
    stopReason: "tool_use",
    usage: { inputTokens: 29, cacheReadTokens: 2, outputTokens: 12 },
  });
  expect(result.content[1]).toMatchObject({ type: "tool_use", name: "rheo_list", input: {} });
  const start = rpc.calls.find((c) => c.method === "thread/start")?.params as Record<string, unknown>;
  expect(start).toMatchObject({ ephemeral: true, permissions: "spaces-closed", environments: [], dynamicTools: [] });
  expect(start).not.toHaveProperty("sandbox");
  expect(rpc.calls.some((c) => c.method === "thread/resume")).toBe(false);
});

test("native tool events, unknown tools and excessive output fail closed", async () => {
  const dangerous = new FakeRpc();
  dangerous.dangerous = true;
  await expect(runSpacesCodexTurn(dangerous, call, { workspace: "C:\\synthetic" })).rejects.toThrow();
  expect(dangerous.calls.some((c) => c.method === "turn/interrupt")).toBe(true);
  const unknown = new FakeRpc();
  unknown.output = JSON.stringify({ text: "", toolCalls: [{ name: "shell", input: {} }] });
  await expect(runSpacesCodexTurn(unknown, call, { workspace: "C:\\synthetic" })).rejects.toThrow();
  const tooLong = new FakeRpc();
  tooLong.output = "x".repeat(100000);
  await expect(runSpacesCodexTurn(tooLong, call, { workspace: "C:\\synthetic" })).rejects.toThrow();
});

const settingsMetadata = (overrides: Record<string, unknown> = {}) => ({
  threadId: "thread-new",
  threadSettings: {
    cwd: "C:\\synthetic",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    collaborationMode: {
      mode: "default",
      settings: { model: "synthetic-model", reasoning_effort: null, developer_instructions: null },
    },
    model: "synthetic-model",
    modelProvider: "openai",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    activePermissionProfile: { id: "spaces-closed", extends: null },
    ...overrides,
  },
});
test("known settings, moderation and warning metadata never become response content or native operations", async () => {
  for (const sandboxPolicy of [{ type: "readOnly", networkAccess: false }, { type: "readOnly" }]) {
    const rpc = new FakeRpc();
    rpc.notifications = [
      { method: "thread/settings/updated", params: settingsMetadata({ sandboxPolicy }) },
      {
        method: "turn/moderationMetadata",
        params: { threadId: "thread-new", turnId: "turn-new", metadata: { diagnostic: "private-metadata" } },
      },
      { method: "warning", params: { threadId: "thread-new", message: "private-warning" } },
    ];
    const result = await runSpacesCodexTurn(rpc, call, { workspace: "C:\\synthetic" });
    expect(result.text).toBe("Olá");
    expect(JSON.stringify(result)).not.toContain("private-");
  }
});
test("settings drift and malformed known metadata remain blocked", async () => {
  const invalid = [
    { method: "thread/settings/updated", params: settingsMetadata({ activePermissionProfile: { id: ":workspace" } }) },
    { method: "thread/settings/updated", params: settingsMetadata({ cwd: "C:\\other-client" }) },
    {
      method: "thread/settings/updated",
      params: settingsMetadata({ sandboxPolicy: { type: "readOnly", networkAccess: true } }),
    },
    { method: "turn/moderationMetadata", params: { threadId: "thread-new", turnId: "turn-new" } },
    { method: "warning", params: { threadId: "thread-new", message: { unexpected: "private-marker" } } },
  ];
  for (const notification of invalid) {
    const rpc = new FakeRpc();
    rpc.notifications = [notification];
    await expect(runSpacesCodexTurn(rpc, call, { workspace: "C:\\synthetic" })).rejects.toThrow();
  }
});
test("unknown operations identify only a canonical method and still reject native permission requests", async () => {
  const rpc = new FakeRpc();
  rpc.notifications = [
    { method: "thread/unknownOperation", params: { threadId: "thread-new", secret: "private-marker" } },
  ];
  try {
    await runSpacesCodexTurn(rpc, call, { workspace: "C:\\synthetic" });
    throw new Error("Expected rejection");
  } catch (error) {
    expect(String(error)).toContain("thread/unknownOperation");
    expect(String(error)).not.toContain("private-marker");
  }
  const request = new FakeRpc();
  request.nativeRequest = true;
  await expect(runSpacesCodexTurn(request, call, { workspace: "C:\\synthetic" })).rejects.toThrow(
    "native tool or permission",
  );
});

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});
test("only installation owner may connect; blocked probe never enables models; metadata contains no account details", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  await fixture.db.insert(schema.users).values([
    { id: "owner", name: "Owner", email: "owner@example.com", createdAt: new Date(1) },
    { id: "other", name: "Other", email: "other@example.com", createdAt: new Date(2) },
  ]);
  const rpc = new FakeRpc();
  let starts = 0;
  const service = createSpacesCodex({
    db: fixture.db,
    home: "C:\\synthetic",
    command: "fake-codex",
    inspect: async () => ({ version: "0.167.0-alpha.4.1", executableSha256: "sha" }),
    createClient: async () => {
      starts++;
      return rpc;
    },
    probe: async (_client, options) => ({
      ready: false,
      message: "Commands refused",
      results: [],
      attestation: {
        ...options,
        schemaVersion: 1,
        scope: "command-exec-filesystem-network",
        observedAt: new Date().toISOString(),
        platform: "win32",
        osRelease: "test",
        results: [],
        limitations: [],
      },
    }),
  });
  await expect(service.status("other")).rejects.toThrow();
  expect(starts).toBe(0);
  const status = await service.status("owner");
  expect(status).toMatchObject({
    installed: true,
    connected: true,
    compatible: true,
    loginAvailable: false,
    sandbox: "blocked",
  });
  expect(JSON.stringify(status)).not.toContain("not-returned@example.com");
  expect(rpc.calls.some((c) => c.method === "account/login/start" || c.method === "turn/start")).toBe(false);
  await expect(service.login("owner")).rejects.toThrow();
  service.stop();
});

test("normal ChatGPT login returns only an official auth link and rejects API-key authentication", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  await fixture.db.insert(schema.users).values({ id: "owner", name: "Owner", email: "owner@example.com" });
  const panel = await bootstrapRheoSpaces(fixture.db, "owner");
  const rpc = new FakeRpc();
  rpc.account = null;
  const service = createSpacesCodex({
    db: fixture.db,
    home: "C:\\synthetic",
    command: "fake-codex",
    inspect: async () => ({ version: "0.167.0-alpha.4.1", executableSha256: "sha" }),
    createClient: async () => rpc,
    probe: async (_client, options) => ({
      ready: true,
      message: "Validated",
      results: [],
      attestation: {
        ...options,
        schemaVersion: 1,
        scope: "command-exec-filesystem-network",
        observedAt: new Date().toISOString(),
        platform: "win32",
        osRelease: "test",
        results: [],
        limitations: [],
      },
    }),
  });
  expect(await service.login("owner")).toEqual({ authUrl: "https://auth.openai.com/authorize?state=test" });
  expect(await service.status("owner")).toMatchObject({ loginAvailable: true, sandbox: "pending", connected: false });
  rpc.account = { type: "chatgpt", planType: "plus" };
  expect(await service.subscription.available(panel.controlOrgId as string)).toBe(false);
  expect(rpc.calls.find((c) => c.method === "account/login/start")?.params).toMatchObject({ type: "chatgpt" });
  rpc.login = { type: "chatgpt", authUrl: "https://auth.openai.com.evil.example/steal" };
  await expect(service.login("owner")).rejects.toThrow();
  rpc.account = { type: "apiKey" };
  expect((await service.status("owner")).connected).toBe(false);
  service.stop();
});

test("revoking a real protected workspace during the model turn withholds its result and every delta", async () => {
  const f = await setup();
  close = f.close;
  await f.db.update(schema.organizations).set({ rheoProtected: true }).where(eq(schema.organizations.id, f.org.id));
  await f.db
    .insert(schema.rheoWorkspaces)
    .values({ orgId: f.org.id, controlOrgId: f.org.id, ownerUserId: f.owner.id, kind: "project", state: "active" });
  const message = await postPersonMessage(f, f.owner.id, f.org.id, f.general.id, { body: "Only this project" });
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
  const rpc = new FakeRpc();
  rpc.onTurn = async () => {
    await f.db
      .update(schema.rheoWorkspaces)
      .set({ state: "archived" })
      .where(eq(schema.rheoWorkspaces.orgId, f.org.id));
  };
  const service = createSpacesCodex({
    db: f.db,
    readNativeProof: async () => true,
    home: "C:\\synthetic",
    command: "fake-codex",
    createClient: async () => rpc,
    inspect: async () => ({ version: "0.167.0-alpha.4.1", executableSha256: "sha" }),
    probe: async (_client, options) => ({
      ready: true,
      message: "test double",
      results: [{ id: "native-tool-boundary", passed: true, detail: "test double" }],
      attestation: {
        ...options,
        schemaVersion: 1,
        scope: "command-exec-filesystem-network",
        observedAt: new Date().toISOString(),
        platform: "win32",
        osRelease: "test",
        results: [],
        limitations: [],
      },
    }),
  });
  const deltas: string[] = [];
  await expect(
    service.subscription.stream({
      ...call,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: run?.id,
      personId: f.owner.id,
      onDelta: (text) => deltas.push(text),
    }),
  ).rejects.toThrow();
  expect(deltas).toEqual([]);
  expect(rpc.calls.some((c) => c.method === "turn/start")).toBe(true);
  expect(f.provider.calls).toHaveLength(0);
  service.stop();
});

test("a second owner cannot use the installation owner's subscription in their own protected organization", async () => {
  const fixture = await createTestDatabase();
  close = fixture.close;
  await fixture.db.insert(schema.users).values([
    { id: "owner", name: "Owner", email: "owner@example.com", createdAt: new Date(1) },
    { id: "other", name: "Other", email: "other@example.com", createdAt: new Date(2) },
  ]);
  const panel = await bootstrapRheoSpaces(fixture.db, "other");
  let starts = 0;
  const service = createSpacesCodex({
    db: fixture.db,
    home: "C:\\synthetic",
    command: "fake-codex",
    createClient: async () => {
      starts++;
      return new FakeRpc();
    },
  });
  expect(await service.subscription.handles(panel.controlOrgId as string)).toBe(true);
  expect(await service.subscription.available(panel.controlOrgId as string)).toBe(false);
  await expect(
    service.subscription.stream({ ...call, orgId: panel.controlOrgId as string, personId: "other" }),
  ).rejects.toThrow();
  expect(starts).toBe(0);
  service.stop();
});

test("subscription routes enforce native session, owner authority and same-origin JSON without spawning a CLI", async () => {
  const t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
  close = t.close;
  const service = createSpacesCodex({ db: t.db, home: "C:\\synthetic", command: null });
  const app = createApp({
    edition: "selfhost",
    version: "test",
    modules: [],
    pingDatabase: async () => {},
    services: { db: t.db, auth: t.auth, config: t.config, adapters: t.adapters, spacesCodex: service },
  });
  const server = { ...t, app };
  expect((await app.request("/api/app/spaces/codex")).status).toBe(401);
  const owner = browser(server);
  await signUp(owner, "owner-codex@example.com");
  const status = await owner("/api/app/spaces/codex");
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({ installed: false, connected: false, sandbox: "pending", version: null });
  expect((await owner("/api/app/spaces/codex/login", { json: {}, origin: "https://elsewhere.example" })).status).toBe(
    403,
  );
  expect((await owner("/api/app/spaces/codex/login", { json: {} })).status).toBe(400);
  const other = browser(server);
  await signUp(other, "other-codex@example.com");
  expect((await other("/api/app/spaces/codex")).status).toBe(403);
  expect((await other("/api/app/spaces/codex/login", { json: {} })).status).toBe(403);
  service.stop();
});
