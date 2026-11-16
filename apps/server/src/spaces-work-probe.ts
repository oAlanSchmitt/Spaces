import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { CodexAppClient, codexIsolatedPolicy, codexIsolatedThreadMatches } from "../runner/brain-codex-app";
import type { SpacesProbeClient, SpacesProbeResult } from "./spaces-codex-probe";
import {
  type SpacesWorkProof,
  type SpacesWorkProofIdentity,
  saveSpacesWorkProof,
  spacesWorkProofPath,
  validateSpacesWorkProof,
} from "./spaces-work-proof";

export interface SpacesWorkProbeReport {
  ready: boolean;
  message: string;
  results: SpacesProbeResult[];
  evidencePath?: string;
  attestation?: SpacesWorkProof;
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const key = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
const inside = (root: string, target: string) =>
  key(target) === key(root) || key(target).startsWith(`${key(root)}${path.sep}`);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1500);
const timeoutMs = 90_000;
function canonical(value: string) {
  const full = path.resolve(value);
  if (key(realpathSync(full)) !== key(full) || lstatSync(full).isSymbolicLink() || !lstatSync(full).isDirectory())
    throw new Error("Canary roots must be real existing directories");
  return full;
}

/** No model or login is requested; filesystem probes inspect only new synthetic markers. */
export async function runSpacesWorkCanaries(
  client: SpacesProbeClient,
  expected: SpacesWorkProofIdentity,
  threadPolicy?: SpacesProbeResult,
): Promise<SpacesWorkProbeReport> {
  const results: SpacesProbeResult[] = [];
  if (threadPolicy) results.push(threadPolicy);
  const report: SpacesWorkProbeReport = { ready: false, message: "Work confinement has not been verified", results };
  if (process.platform !== "win32") return { ...report, message: "This work confinement probe verifies Windows only" };
  const workspace = canonical(expected.workspace);
  const home = canonical(expected.home);
  if (inside(workspace, home) || inside(home, workspace) || expected.permissionProfile !== "spaces-work")
    throw new Error("Work canaries need distinct project and account roots and the work profile");
  const runId = randomUUID();
  const directory = path.join(home, "work-probes", runId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  canonical(directory);
  const proofFile = spacesWorkProofPath(home, workspace);
  if (existsSync(proofFile)) {
    canonical(path.dirname(proofFile));
    unlinkSync(proofFile);
  }
  const nonce = `SPACES_WORK_${runId}`;
  const otherRoot = path.join(directory, "B");
  const dbRoot = path.join(directory, "synthetic-db");
  for (const root of [otherRoot, dbRoot]) mkdirSync(root);
  const files = {
    positive: path.join(workspace, `.spaces-positive-${runId}.txt`),
    written: path.join(workspace, `.spaces-written-${runId}.txt`),
    test: path.join(workspace, `.spaces-test-${runId}.cmd`),
    other: path.join(otherRoot, "synthetic-project.txt"),
    home: path.join(home, `.spaces-synthetic-auth-${runId}.txt`),
    db: path.join(dbRoot, "synthetic-record.txt"),
    outside: path.join(otherRoot, "must-not-exist.txt"),
  };
  for (const file of [files.positive, files.other, files.home, files.db])
    writeFileSync(file, nonce, { flag: "wx", mode: 0o600 });
  writeFileSync(
    files.test,
    `@echo off\r\nset /a sum=20+22 >nul\r\nif not "%sum%"=="42" exit /b 1\r\necho ${nonce}\r\n`,
    { flag: "wx", mode: 0o600 },
  );
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const powershell = path.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const curl = path.join(systemRoot, "System32/curl.exe");
  const ps = (script: string) => [
    powershell,
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(`$ErrorActionPreference='Stop';${script}`, "utf16le").toString("base64"),
  ];
  const read = (file: string) => ps(`Get-Content -LiteralPath ${quote(file)} -Raw`);
  const write = (file: string) => ps(`Set-Content -LiteralPath ${quote(file)} -Value ${quote(nonce)} -NoNewline`);
  const denied = (r: { exitCode: number; stdout: string; stderr: string }) =>
    r.exitCode !== 0 && !r.stdout.includes(nonce) && !r.stderr.includes(nonce);
  const deadline = Date.now() + timeoutMs;
  const execute = async (
    id: string,
    command: string[],
    verify: (r: { exitCode: number; stdout: string; stderr: string }) => boolean | Promise<boolean>,
    detail: string,
  ) => {
    const processId = randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Work canary deadline exceeded");
      const raw = await Promise.race([
        client.request("command/exec", {
          command,
          cwd: workspace,
          permissionProfile: expected.permissionProfile,
          processId,
          timeoutMs: Math.min(6000, remaining),
          outputBytesCap: 4096,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Canary RPC exceeded its deadline")), Math.min(12_000, remaining));
        }),
      ]);
      const r = raw as { exitCode: number; stdout: string; stderr: string };
      if (!r || !Number.isInteger(r.exitCode) || typeof r.stdout !== "string" || typeof r.stderr !== "string")
        throw new Error("Invalid command/exec response");
      const passed = await verify(r);
      results.push({
        id,
        passed,
        detail: passed ? detail : `${detail}; exit=${r.exitCode}`,
        exitCode: r.exitCode,
        stdout: r.stdout.slice(0, 4096),
        stderr: r.stderr.slice(0, 4096),
      });
      return passed;
    } catch (error) {
      results.push({ id, passed: false, detail: message(error) });
      await Promise.race([
        client.request("command/exec/terminate", { processId }).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const sockets = new Set<Socket>();
  let server: ReturnType<typeof createServer> | undefined;
  let junction: string | undefined;
  try {
    if (
      !(await execute(
        "read-workspace",
        read(files.positive),
        (r) => r.exitCode === 0 && r.stdout.trim() === nonce,
        "Project read returned the exact synthetic marker",
      ))
    )
      return report;
    if (
      !(await execute(
        "write-workspace",
        write(files.written),
        (r) => r.exitCode === 0 && existsSync(files.written) && readFileSync(files.written, "utf8") === nonce,
        "Project write created the exact synthetic file",
      ))
    )
      return report;
    if (
      !(await execute(
        "execute-test",
        [path.join(systemRoot, "System32/cmd.exe"), "/d", "/c", path.basename(files.test)],
        (r) => r.exitCode === 0 && r.stdout.trim() === nonce,
        "The local synthetic code assertion executed successfully",
      ))
    )
      return report;
    for (const [id, file] of [
      ["read-other-root", files.other],
      ["read-home", files.home],
      ["read-synthetic-db", files.db],
    ] as const)
      await execute(id, read(file), denied, "The synthetic marker outside the project was not readable");
    await execute(
      "write-outside-workspace",
      write(files.outside),
      (r) => denied(r) && !existsSync(files.outside),
      "No outside file was created",
    );
    await execute(
      "read-traversal",
      read(`${workspace}${path.sep}${path.relative(workspace, files.other)}`),
      denied,
      "Parent traversal did not expose the synthetic sibling",
    );
    junction = path.join(workspace, `.spaces-junction-${runId}`);
    symlinkSync(otherRoot, junction, "junction");
    await execute(
      "read-junction",
      read(path.join(junction, path.basename(files.other))),
      denied,
      "A project junction did not expose the synthetic sibling",
    );
    if (
      !(await execute(
        "native-network-client",
        [curl, "--version"],
        (r) => r.exitCode === 0 && /\bcurl\b/i.test(r.stdout) && /\btelnet\b/i.test(r.stdout),
        "The native network client supports HTTP and TCP",
      ))
    )
      return report;
    let connections = 0;
    let requests = 0;
    server = createServer((_request, response) => {
      requests++;
      response.writeHead(200, { connection: "close" });
      response.end(nonce);
    });
    server.on("connection", (socket) => {
      connections++;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The synthetic listener has no port");
    const url = `http://127.0.0.1:${address.port}/${runId}`;
    const positive = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { connection: "close" } });
    const hostPassed = positive.status === 200 && (await positive.text()) === nonce && requests > 0 && connections > 0;
    results.push({
      id: "host-listener",
      passed: hostPassed,
      detail: "The host control reached the exact synthetic listener",
    });
    if (!hostPassed) return report;
    for (const [id, endpoint, extra] of [
      ["network-tcp-loopback", `telnet://127.0.0.1:${address.port}`, []],
      ["network-http-loopback", url, []],
      ["network-http-localhost", `http://localhost:${address.port}/${runId}`, ["--ipv4"]],
    ] as const) {
      const beforeConnections = connections;
      const beforeRequests = requests;
      await execute(
        id,
        [curl, "--silent", "--show-error", "--max-time", "2", "--noproxy", "*", ...extra, endpoint],
        async (r) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return denied(r) && connections === beforeConnections && requests === beforeRequests;
        },
        "The native connection failed without reaching the host listener",
      );
    }
    const proof: SpacesWorkProof = {
      ...expected,
      schemaVersion: 2,
      scope: "work-command-exec-filesystem-network",
      observedAt: new Date().toISOString(),
      platform: process.platform,
      osRelease: os.release(),
      hostname: os.hostname(),
      results,
      limitations: [
        "Finite command/exec filesystem/network controls, not a universal isolation guarantee",
        "Native model tools and image/account capability require separate real turns",
        "No model or new login was requested; the agent inspected no existing credential or customer file",
      ],
    };
    if (validateSpacesWorkProof(proof, expected)) {
      await saveSpacesWorkProof(proof);
      report.attestation = proof;
      report.ready = true;
      report.message = "The work profile passed every finite command/filesystem/network control";
    }
    return report;
  } catch (error) {
    results.push({ id: "probe-runtime", passed: false, detail: message(error) });
    return report;
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (junction && existsSync(junction)) unlinkSync(junction);
    for (const file of [files.positive, files.written, files.test, files.home]) if (existsSync(file)) unlinkSync(file);
    report.evidencePath = path.join(directory, "probe-result.json");
    writeFileSync(report.evidencePath, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  }
}

export async function probeSpacesWork(
  expected: SpacesWorkProofIdentity,
  options: { command: string; launch: { args: string[]; env: NodeJS.ProcessEnv } },
): Promise<SpacesWorkProbeReport> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(options.command)) digest.update(chunk);
  if (
    digest.digest("hex") !== expected.executableSha256 ||
    createHash("sha256")
      .update(
        JSON.stringify({
          args: options.launch.args,
          env: options.launch.env,
          workspace: expected.workspace,
          runtimePolicy: codexIsolatedPolicy(expected.permissionProfile, expected.workspace),
        }),
      )
      .digest("hex") !== expected.configurationSha256
  )
    throw new Error("The work probe executable or launch configuration changed");
  const client = new CodexAppClient(options.command, options.launch.args, {
    cwd: expected.workspace,
    env: options.launch.env,
  });
  const deadline = setTimeout(() => client.close(0), timeoutMs);
  try {
    await client.request(
      "initialize",
      {
        clientInfo: { name: "spaces_work_probe", title: "Spaces work confinement", version: "1" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
      10_000,
    );
    client.notify("initialized");
    const started = await client.request<Record<string, unknown>>(
      "thread/start",
      {
        ...codexIsolatedPolicy(expected.permissionProfile, expected.workspace).thread,
        ephemeral: true,
        developerInstructions: "This is a no-model work confinement handshake. No task or tool action is requested.",
      },
      10_000,
    );
    const status = await client.request<{ status?: unknown }>("environment/status", { environmentId: "local" }, 10_000);
    const passed =
      codexIsolatedThreadMatches(started, expected.permissionProfile, expected.workspace) && status?.status === "ready";
    const threadPolicy: SpacesProbeResult = {
      id: "thread-policy",
      passed,
      detail: passed
        ? "The real ephemeral thread selected the exact named work profile and a ready local environment confined to this workspace"
        : "The real thread did not confirm the exact named profile, ready local environment and workspace",
    };
    if (!passed) return { ready: false, message: threadPolicy.detail, results: [threadPolicy] };
    return await runSpacesWorkCanaries(client, expected, threadPolicy);
  } finally {
    clearTimeout(deadline);
    client.close(0);
  }
}
