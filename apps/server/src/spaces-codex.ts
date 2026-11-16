import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { and, type Database, eq, schema } from "@agenteschat/db";
import {
  assertRheoRun,
  assertRheoSourcesCurrent,
  ForbiddenError,
  type GatewayCall,
  getMembership,
  MissingCredentialError,
  pinnedOwner,
  readRheoPolicy,
  type SubscriptionModel,
  ValidationError,
  validateJson,
} from "@agenteschat/engine";
import { laidOut, type ModelResult, type ModelUsage, ProviderError } from "@agenteschat/providers";
import { CodexAppClient, type ServerRequestHandler } from "../runner/brain-codex-app";
import { readSpacesNativeProof } from "./spaces-codex-native-proof";
import { probeSpacesCodex } from "./spaces-codex-probe";
import { createSpacesWork } from "./spaces-work";

/** Audited against the JSON schemas shipped by this installed CLI, not a floating minimum version. */
export const SPACES_CODEX_VERSION = "0.167.0-alpha.4.1";
export const SPACES_CODEX_PROFILE = "spaces-closed";
const INPUT_CHARS = 400_000;
const JSON_CHARS = 65_536;
const TURN_TIMEOUT_MS = 3 * 60_000;
const INTERNAL_TOOLS = new Set([
  "rheo_list",
  "rheo_create_project",
  "rheo_inspect",
  "rheo_context",
  "rheo_memory",
  "rheo_documents",
  "rheo_tasks",
  "rheo_work",
]);
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const number = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const string = (v: unknown) => (typeof v === "string" ? v : "");

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return hash.digest("hex");
}

export interface SpacesCodexRpc {
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(handler: (method: string, params: Record<string, unknown>) => void): () => void;
  onRequest(handler: ServerRequestHandler | null): void;
  onExit?(handler: () => void): () => void;
  close(graceMs?: number): void;
}

/** The host inherits neither tokens nor Codex/agent settings from the server's environment. */
export function spacesCodexLaunch(input: { home: string; workspace: string; env?: NodeJS.ProcessEnv }) {
  const source = input.env ?? process.env;
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "ProgramFiles", "ProgramData", "OS", "PROCESSOR_ARCHITECTURE"]) {
    if (source[key]) env[key] = source[key];
  }
  // Harness PATH entries are ephemeral; the CLI is already resolved to its executable before launch.
  if (process.platform === "win32") {
    const system32 = path.win32.join(source.SystemRoot ?? "C:\\Windows", "System32");
    env.PATH = [system32, path.win32.join(system32, "WindowsPowerShell", "v1.0")].join(";");
  }
  Object.assign(env, {
    CODEX_HOME: input.home,
    HOME: input.home,
    USERPROFILE: input.home,
    APPDATA: path.join(input.home, "appdata"),
    LOCALAPPDATA: path.join(input.home, "localappdata"),
    TEMP: path.join(input.home, "temp"),
    TMP: path.join(input.home, "temp"),
  });
  const disabled = [
    "shell_tool",
    "unified_exec",
    "unified_exec_tty",
    "code_mode_host",
    "memories",
    "hooks",
    "plugins",
    "apps",
    "multi_agent",
    "multi_agent_v2",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "browser_annotation_api",
    "in_app_browser",
    "in_app_local_automation",
    "computer_use",
    "view_image",
    "image_generation",
    "goals",
    "workspace_dependencies",
    "skill_mcp_dependency_install",
    "skill_search",
  ];
  const config = [
    `default_permissions="${SPACES_CODEX_PROFILE}"`,
    'permissions={spaces-closed={filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="read"},":tmpdir"="deny",":slash_tmp"="deny"},network={enabled=false}}}',
    'windows.sandbox="mxc"',
    'approval_policy="never"',
    'forced_login_method="chatgpt"',
    "agents.enabled=false",
    "features.code_mode.direct_only_tool_namespaces=[]",
    'web_search="disabled"',
    "project_doc_max_bytes=0",
    "mcp_servers={}",
    "features.skip_host_skill_discovery=true",
    ...disabled.map((feature) => `features.${feature}=false`),
  ];
  return { args: ["app-server", "--strict-config", ...config.flatMap((value) => ["-c", value])], env };
}

export async function createSpacesCodexRpc(input: {
  command: string;
  home: string;
  workspace: string;
}): Promise<SpacesCodexRpc> {
  const privateRoot = path.resolve(import.meta.dir, "../../../.rheo");
  const home = path.resolve(input.home);
  if (!home.toLowerCase().startsWith(`${privateRoot.toLowerCase()}${path.sep}`))
    throw new ValidationError("Spaces Codex must use its dedicated data home inside this fork");
  for (let part = home; ; part = path.dirname(part)) {
    if (
      existsSync(part) &&
      (lstatSync(part).isSymbolicLink() || realpathSync(part).toLowerCase() !== part.toLowerCase())
    )
      throw new ValidationError("Spaces Codex data home cannot traverse a redirected directory");
    if (path.dirname(part) === part) break;
  }
  for (const dir of [input.home, input.workspace, "temp", "appdata", "localappdata"].map((dir) =>
    path.isAbsolute(dir) ? dir : path.join(input.home, dir),
  ))
    await mkdir(dir, { recursive: true });
  const launch = spacesCodexLaunch(input);
  const client = new CodexAppClient(input.command, launch.args, { cwd: input.workspace, env: launch.env });
  try {
    await client.request("initialize", {
      clientInfo: { name: "spaces", title: "Spaces", version: "1" },
      capabilities: { experimentalApi: true },
    });
    client.notify("initialized");
    return client;
  } catch {
    client.close(0);
    throw new ValidationError("Codex could not start with the required isolation configuration");
  }
}

function outputSchema(call: GatewayCall, cap: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text", "toolCalls"],
    properties: {
      text: { type: "string", maxLength: cap },
      toolCalls: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "input"],
          properties: {
            name: {
              type: "string",
              enum: call.tools?.length ? call.tools.map((tool) => tool.name) : ["__no_tool_allowed__"],
            },
            input: {
              type: "string",
              maxLength: 16_384,
              description: "A JSON object encoded as a JSON string, validated by Spaces before execution",
            },
          },
        },
      },
    },
  };
}

function protectedThreadSettings(value: unknown, workspace: string): boolean {
  if (!object(value) || !object(value.activePermissionProfile) || !object(value.sandboxPolicy)) return false;
  const profile = value.activePermissionProfile;
  const sandbox = value.sandboxPolicy;
  const collaboration = value.collaborationMode;
  return (
    typeof value.cwd === "string" &&
    path.normalize(value.cwd).toLowerCase() === path.normalize(workspace).toLowerCase() &&
    value.approvalPolicy === "never" &&
    profile.id === SPACES_CODEX_PROFILE &&
    (profile.extends === undefined || profile.extends === null) &&
    sandbox.type === "readOnly" &&
    (sandbox.networkAccess === undefined || sandbox.networkAccess === false) &&
    ["user", "auto_review", "guardian_subagent"].includes(string(value.approvalsReviewer)) &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.modelProvider === "openai" &&
    object(collaboration) &&
    ["default", "plan"].includes(string(collaboration.mode)) &&
    object(collaboration.settings) &&
    typeof collaboration.settings.model === "string"
  );
}

const notificationName = (method: string) =>
  /^[a-z][a-zA-Z]{0,31}(?:\/[a-z][a-zA-Z]{0,31}){1,3}$/.test(method) ? method : "unknown method";

/** No native tool is serviced. The result only proposes calls to the existing, authorized Tool Gateway. */
export async function runSpacesCodexTurn(
  client: SpacesCodexRpc,
  call: GatewayCall,
  options: { workspace: string },
): Promise<ModelResult> {
  if (call.signal?.aborted) throw new ProviderError("Codex call canceled", false);
  if (call.tools?.some((tool) => !INTERNAL_TOOLS.has(tool.name)))
    throw new ProviderError("Unsupported Spaces tool", false);
  const cap = Math.min(JSON_CHARS, Math.max(2048, Math.floor(call.maxTokens) * 8));
  const request = laidOut({
    model: "codex-subscription",
    system: call.system,
    messages: call.messages,
    notes: call.notes,
    maxTokens: call.maxTokens,
    tools: call.tools,
  });
  const system =
    typeof request.system === "string" ? request.system : request.system.map((block) => block.text).join("\n\n");
  const prompt = JSON.stringify({ messages: request.messages, tools: call.tools ?? [] });
  if (prompt.length + system.length > INPUT_CHARS)
    throw new ProviderError("This Spaces request exceeds the subscription context limit", false);
  const started = await client.request<unknown>("thread/start", {
    cwd: options.workspace,
    runtimeWorkspaceRoots: [options.workspace],
    permissions: SPACES_CODEX_PROFILE,
    approvalPolicy: "never",
    ephemeral: true,
    dynamicTools: [],
    environments: [],
    selectedCapabilityRoots: [],
    allowProviderModelFallback: false,
    baseInstructions:
      "You are the Spaces model transport. Use only the supplied context. Never use native tools, files, browsing, skills, commands or delegation. Return the required JSON object. toolCalls are proposals only; encode each input object as a JSON string. Spaces validates and executes them separately.",
    developerInstructions: system,
  });
  const threadId = object(started) && object(started.thread) ? string(started.thread.id) : "";
  const model = object(started) ? string(started.model) : "";
  if (!threadId) throw new ProviderError("Codex returned an incompatible thread response", false);
  let text = "";
  let finalText = "";
  let outputChars = 0;
  let turnId = "";
  const tokens: { usage: ModelUsage | null } = { usage: null };
  let settled = false;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const done = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const fail = (message: string, status?: number) => {
    if (settled) return;
    settled = true;
    if (turnId) void client.request("turn/interrupt", { threadId, turnId }).catch(() => {});
    reject(new ProviderError(message, false, status, tokens.usage ? { ...tokens.usage, outputChars } : undefined));
  };
  const allowed = new Set([
    "thread/started",
    "thread/status/changed",
    "turn/started",
    "turn/completed",
    "item/started",
    "item/completed",
    "item/agentMessage/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/textDelta",
    "thread/tokenUsage/updated",
    "error",
  ]);
  const unsubscribe = client.onNotification((method, params) => {
    if (params.threadId !== threadId || settled) return;
    if (typeof params.turnId === "string") turnId ||= params.turnId;
    // Installed 0.167 schema: these notifications report state, never invoke a tool or contribute reply content.
    if (method === "thread/settings/updated") {
      if (!protectedThreadSettings(params.threadSettings, options.workspace))
        fail("Codex reported incompatible protected settings (thread/settings/updated)");
      return;
    }
    if (method === "turn/moderationMetadata") {
      if (typeof params.turnId !== "string" || !params.turnId || !("metadata" in params))
        fail("Codex reported malformed metadata (turn/moderationMetadata)");
      return;
    }
    if (method === "warning") {
      if (typeof params.message !== "string") fail("Codex reported malformed metadata (warning)");
      return;
    }
    if (!allowed.has(method)) {
      fail(`Codex attempted an unsupported native operation (${notificationName(method)})`);
      return;
    }
    if ((method === "item/started" || method === "item/completed") && object(params.item)) {
      if (!["userMessage", "agentMessage", "reasoning"].includes(string(params.item.type))) {
        fail("Codex native tools are blocked in Spaces");
        return;
      }
      if (method === "item/completed" && params.item.type === "agentMessage" && typeof params.item.text === "string")
        finalText = params.item.text;
    }
    if (typeof params.delta === "string") {
      outputChars += params.delta.length;
      if (outputChars > cap) {
        fail("Codex exceeded the Spaces output limit");
        return;
      }
      if (method === "item/agentMessage/delta") text += params.delta;
    }
    if (method === "thread/tokenUsage/updated" && object(params.tokenUsage) && object(params.tokenUsage.total)) {
      const total = params.tokenUsage.total;
      const cached = number(total.cachedInputTokens);
      tokens.usage = {
        inputTokens: Math.max(0, number(total.inputTokens) - cached),
        outputTokens: number(total.outputTokens),
        cacheReadTokens: cached,
        cacheWriteTokens: number(total.cacheWriteInputTokens),
      };
      if (tokens.usage.outputTokens > call.maxTokens) {
        fail("Codex exceeded the Spaces output token limit");
        return;
      }
    }
    if (method === "error") {
      const error = object(params.error) ? params.error : {};
      const quota = JSON.stringify(error.codexErrorInfo ?? "").includes("usageLimitExceeded");
      fail(
        quota
          ? "Your Codex subscription limit has been reached. Wait for the quota to reset."
          : "The Codex subscription call failed",
        quota ? 429 : undefined,
      );
    }
    if (method === "turn/completed" && object(params.turn)) {
      turnId ||= string(params.turn.id);
      if (params.turn.status !== "completed") {
        const error = object(params.turn.error) ? params.turn.error : {};
        const quota = JSON.stringify(error.codexErrorInfo ?? "").includes("usageLimitExceeded");
        fail(
          quota
            ? "Your Codex subscription limit has been reached. Wait for the quota to reset."
            : "The Codex subscription call did not complete",
          quota ? 429 : undefined,
        );
      } else {
        settled = true;
        resolve();
      }
    }
  });
  client.onRequest(() => {
    fail("Codex requested a native tool or permission outside Spaces");
    return Promise.resolve({ error: { code: -32601, message: "Native operations are disabled in Spaces" } });
  });
  const abort = () => fail("Codex call canceled");
  call.signal?.addEventListener("abort", abort, { once: true });
  if (call.signal?.aborted) abort();
  const offExit = client.onExit?.(() => fail("Codex disconnected during the subscription call"));
  const timer = setTimeout(() => fail("Codex subscription call timed out"), TURN_TIMEOUT_MS);
  try {
    // Register listeners first: a short turn may finish before turn/start's reply is read.
    if (!settled)
      void client
        .request("turn/start", {
          threadId,
          cwd: options.workspace,
          permissions: SPACES_CODEX_PROFILE,
          approvalPolicy: "never",
          environments: [],
          input: [{ type: "text", text: prompt, text_elements: [] }],
          outputSchema: outputSchema(call, cap),
        })
        .then(
          (start) => {
            if (object(start) && object(start.turn)) turnId ||= string(start.turn.id);
          },
          () => fail("Codex could not start the subscription turn"),
        );
    await done;
    const raw = finalText || text;
    if (raw.length > cap || !tokens.usage)
      throw new ProviderError("Codex returned missing usage or excessive output", false);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ProviderError("Codex returned invalid structured output", false);
    }
    if (validateJson(outputSchema(call, cap), payload).length || !object(payload) || !Array.isArray(payload.toolCalls))
      throw new ProviderError("Codex returned incompatible structured output", false);
    const content: ModelResult["content"] = payload.text ? [{ type: "text", text: string(payload.text) }] : [];
    for (const proposed of payload.toolCalls) {
      if (!object(proposed)) throw new ProviderError("Invalid Spaces tool proposal", false);
      const tool = call.tools?.find((spec) => spec.name === proposed.name);
      let input: unknown;
      try {
        input = JSON.parse(string(proposed.input));
      } catch {
        throw new ProviderError("Invalid Spaces tool input", false);
      }
      if (!tool || !object(input) || validateJson(tool.inputSchema, input).length)
        throw new ProviderError("Invalid Spaces tool proposal", false);
      content.push({ type: "tool_use", id: crypto.randomUUID(), name: tool.name, input });
    }
    const result: ModelResult = {
      text: string(payload.text),
      content,
      model: model || "codex-subscription",
      stopReason: payload.toolCalls.length ? "tool_use" : "end_turn",
      usage: tokens.usage,
    };
    return result;
  } catch (error) {
    const failure =
      error instanceof ProviderError ? error : new ProviderError("The Codex subscription transport failed", false);
    if (!failure.partial && tokens.usage) failure.partial = { ...tokens.usage, outputChars };
    throw failure;
  } finally {
    clearTimeout(timer);
    unsubscribe();
    offExit?.();
    client.onRequest(null);
    call.signal?.removeEventListener("abort", abort);
    void client.request("thread/unsubscribe", { threadId }).catch(() => {});
  }
}

export interface SpacesCodexStatus {
  installed: boolean;
  connected: boolean;
  compatible: boolean;
  loginAvailable: boolean;
  sandbox: "pending" | "ready" | "blocked";
  version: string | null;
  message?: string;
}
type Inspect = { version: string; executableSha256: string };
type Options = {
  db: Database;
  home: string;
  command?: string | null;
  createClient?: typeof createSpacesCodexRpc;
  inspect?: () => Promise<Inspect>;
  probe?: typeof probeSpacesCodex;
  readNativeProof?: typeof readSpacesNativeProof;
};

export function createSpacesCodex(options: Options) {
  if (!path.isAbsolute(options.home)) throw new Error("Spaces Codex requires an explicit absolute data home");
  const command = options.command === undefined ? Bun.which("codex") : options.command;
  const workspace = path.join(options.home, "workspace");
  let accountQueue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const next = accountQueue.catch(() => undefined).then(work);
    accountQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const factory = options.createClient ?? createSpacesCodexRpc;
  let runtime: Promise<{
    client: SpacesCodexRpc;
    status: SpacesCodexStatus;
    fingerprint: Inspect;
    configurationSha256: string;
  }> | null = null;
  let lastVersion: string | null = null;
  const inspect =
    options.inspect ??
    (async () => {
      if (!command) throw new Error("Codex not installed");
      await mkdir(options.home, { recursive: true });
      const launch = spacesCodexLaunch({ home: options.home, workspace });
      const child = Bun.spawn([command, "--version"], {
        env: launch.env,
        cwd: options.home,
        stdout: "pipe",
        stderr: "ignore",
        windowsHide: true,
      });
      const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      if (code !== 0) throw new Error("Codex version unavailable");
      return {
        version: output.trim().replace(/^codex-cli\s+/, ""),
        executableSha256: await sha256File(command),
      };
    });
  async function authorize(userId: string) {
    const [user] = await options.db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (
      !user ||
      user.blockedAt ||
      user.deletionRequestedAt ||
      user.deletionDueAt ||
      (await pinnedOwner(options.db)) !== userId
    )
      throw new ForbiddenError("Only the installation owner may connect the Spaces subscription");
  }
  async function getRuntime() {
    if (!command) return null;
    runtime ??= (async () => {
      const fingerprint = await inspect();
      lastVersion = fingerprint.version;
      if (fingerprint.version !== SPACES_CODEX_VERSION)
        throw new ValidationError("This Codex version has not been validated for Spaces");
      const client = await factory({ command, home: options.home, workspace });
      try {
        const launch = spacesCodexLaunch({ home: options.home, workspace });
        const configurationSha256 = createHash("sha256")
          .update(JSON.stringify({ args: launch.args, env: launch.env, workspace }))
          .digest("hex");
        const probe = await (options.probe ?? probeSpacesCodex)(client, {
          home: options.home,
          workspace,
          probeRoot: path.join(options.home, "probes"),
          version: fingerprint.version,
          executableSha256: fingerprint.executableSha256,
          configurationSha256,
          permissionProfile: SPACES_CODEX_PROFILE,
        });
        const attestation = probe.attestation;
        const commandApproved =
          probe.ready &&
          attestation?.version === fingerprint.version &&
          attestation.executableSha256 === fingerprint.executableSha256 &&
          attestation.configurationSha256 === configurationSha256 &&
          attestation.permissionProfile === SPACES_CODEX_PROFILE &&
          attestation.workspace === workspace &&
          attestation.home === options.home;
        return {
          client,
          fingerprint,
          configurationSha256,
          status: {
            installed: true,
            connected: false,
            compatible: true,
            loginAvailable: commandApproved,
            sandbox: commandApproved ? "pending" : "blocked",
            version: fingerprint.version,
            message: commandApproved
              ? "Codex command isolation passed separately; native model tools still require isolation verification"
              : "Codex isolation could not be validated on this computer",
          } satisfies SpacesCodexStatus,
        };
      } catch {
        client.close(0);
        throw new ValidationError("Codex isolation validation failed");
      }
    })();
    return runtime;
  }
  async function metadata(): Promise<SpacesCodexStatus> {
    if (!command)
      return {
        installed: false,
        connected: false,
        compatible: false,
        loginAvailable: false,
        sandbox: "pending",
        version: null,
        message: "Install the supported Codex CLI to connect your subscription",
      };
    try {
      const current = await getRuntime();
      if (!current) throw new Error("missing");
      const fresh = await inspect();
      if (
        fresh.version !== current.fingerprint.version ||
        fresh.executableSha256 !== current.fingerprint.executableSha256
      )
        throw new Error("Codex changed after validation");
      const nativeReady =
        current.status.loginAvailable &&
        (await (options.readNativeProof ?? readSpacesNativeProof)({
          home: options.home,
          workspace,
          version: fresh.version,
          executableSha256: fresh.executableSha256,
          configurationSha256: current.configurationSha256,
          permissionProfile: SPACES_CODEX_PROFILE,
        }));
      const response = await current.client.request<unknown>("account/read", { refreshToken: false });
      const account = object(response) && object(response.account) ? response.account : null;
      return {
        ...current.status,
        sandbox: nativeReady ? "ready" : current.status.sandbox,
        ...(nativeReady ? { message: undefined } : {}),
        connected: account?.type === "chatgpt",
        ...(account?.type && account.type !== "chatgpt"
          ? { message: "Spaces requires a normal ChatGPT subscription login, not an API key" }
          : {}),
      };
    } catch {
      return {
        installed: true,
        connected: false,
        compatible: false,
        loginAvailable: false,
        sandbox: "blocked",
        version: lastVersion,
        message: "Codex could not start with the version and isolation required by Spaces",
      };
    }
  }
  const subscription: SubscriptionModel = {
    async handles(orgId) {
      return (await readRheoPolicy(options.db, orgId)) !== null;
    },
    async available(orgId) {
      const policy = await readRheoPolicy(options.db, orgId);
      if (policy?.state !== "active" || (await getMembership(options.db, policy.ownerUserId, orgId))?.role !== "owner")
        return false;
      try {
        await authorize(policy.ownerUserId);
      } catch (error) {
        if (error instanceof ForbiddenError) return false;
        throw error;
      }
      const status = await metadata();
      return status.connected && status.compatible && status.sandbox === "ready";
    },
    async stream(call) {
      return exclusive(async () => {
        if (call.signal?.aborted) throw new ProviderError("Spaces subscription call canceled", false);
        const validate = async () => {
          const [run] = call.runId
            ? await options.db
                .select()
                .from(schema.agentRuns)
                .where(
                  and(
                    eq(schema.agentRuns.id, call.runId),
                    eq(schema.agentRuns.orgId, call.orgId),
                    eq(schema.agentRuns.agentId, call.agentId),
                  ),
                )
            : [];
          if (!run) throw new ForbiddenError("Spaces subscription requires a current owner-requested run");
          const policy = await assertRheoRun(options.db, run);
          if (!policy || call.personId !== policy.ownerUserId)
            throw new ForbiddenError("Spaces subscription authority is unavailable");
          await authorize(policy.ownerUserId);
          await assertRheoSourcesCurrent(options.db, call.orgId, run.id);
        };
        await validate();
        if (!(await subscription.available(call.orgId)))
          throw new MissingCredentialError("Connect Codex and validate isolation in Spaces first");
        const current = await getRuntime();
        const fingerprint = await inspect();
        if (
          !current ||
          fingerprint.version !== current.fingerprint.version ||
          fingerprint.executableSha256 !== current.fingerprint.executableSha256
        )
          throw new ProviderError(
            "Codex changed since its isolation was validated. Restart Spaces to validate it again.",
            false,
          );
        const client = await factory({ command: command as string, home: options.home, workspace });
        const abort = () => client.close(0);
        call.signal?.addEventListener("abort", abort, { once: true });
        try {
          if (call.signal?.aborted) throw new ProviderError("Spaces subscription call canceled", false);
          const result = await runSpacesCodexTurn(client, call, { workspace });
          try {
            await validate();
          } catch {
            throw new ProviderError(
              "The Spaces response was withheld because its authority or sources changed",
              false,
              403,
              { ...result.usage, outputChars: result.text.length },
            );
          }
          return result;
        } finally {
          call.signal?.removeEventListener("abort", abort);
          client.close(0);
        }
      });
    },
  };
  const work = createSpacesWork({
    db: options.db,
    home: options.home,
    exclusive,
    async identity(userId) {
      await authorize(userId);
      const current = await getRuntime();
      const fresh = await inspect();
      if (
        !current?.status.loginAvailable ||
        fresh.version !== current.fingerprint.version ||
        fresh.executableSha256 !== current.fingerprint.executableSha256
      )
        throw new ValidationError("O Codex mudou ou a ligação não é compatível.");
      const response = await current.client.request<unknown>("account/read", { refreshToken: false });
      const account = object(response) && object(response.account) ? response.account : null;
      if (account?.type !== "chatgpt" || !string(account.email))
        throw new MissingCredentialError("Ligue a assinatura ChatGPT existente no Spaces.");
      return {
        ...fresh,
        command: command as string,
        accountFingerprint: createHash("sha256")
          .update(
            JSON.stringify({
              type: account.type,
              email: account.email,
              id: account.id ?? account.chatgptAccountId ?? null,
            }),
          )
          .digest("hex"),
      };
    },
  });
  return {
    subscription,
    work,
    async status(userId: string) {
      await authorize(userId);
      return metadata();
    },
    async login(userId: string) {
      await authorize(userId);
      const status = await metadata();
      if (!status.compatible || !status.loginAvailable)
        throw new ValidationError("Validate Codex isolation before signing in");
      const current = await getRuntime();
      if (!current) throw new ValidationError("Codex is not installed");
      const response = await current.client.request<unknown>("account/login/start", {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
      });
      if (!object(response) || response.type !== "chatgpt")
        throw new ValidationError("A normal ChatGPT subscription login is required");
      let url: URL;
      try {
        url = new URL(string(response.authUrl));
      } catch {
        throw new ValidationError("Codex returned an invalid login link");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !["auth.openai.com", "chatgpt.com"].includes(url.hostname)
      )
        throw new ValidationError("Codex returned an unsupported login link");
      return { authUrl: url.href };
    },
    stop() {
      work.stop();
      void runtime?.then((current) => current.client.close(0)).catch(() => {});
      runtime = null;
    },
  };
}

export type SpacesCodex = ReturnType<typeof createSpacesCodex>;
