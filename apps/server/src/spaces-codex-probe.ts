import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { SPACES_PRIVATE_ROOT } from "./spaces-private-root";

export interface SpacesProbeClient {
  request(method: string, params: unknown): Promise<unknown>;
}
export interface SpacesProbeOptions {
  workspace: string;
  probeRoot: string;
  home: string;
  version: string;
  executableSha256: string;
  configurationSha256: string;
  permissionProfile: string;
}
export interface SpacesProbeResult {
  id: string;
  passed: boolean | null;
  detail: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}
export interface SpacesCodexAttestation {
  schemaVersion: 1;
  scope: "command-exec-filesystem-network";
  observedAt: string;
  version: string;
  executableSha256: string;
  configurationSha256: string;
  permissionProfile: string;
  workspace: string;
  home: string;
  platform: string;
  osRelease: string;
  results: SpacesProbeResult[];
  limitations: string[];
}
export interface SpacesProbeReport {
  ready: boolean;
  message: string;
  results: SpacesProbeResult[];
  evidencePath?: string;
  attestation?: SpacesCodexAttestation;
}

const privateRoot = SPACES_PRIVATE_ROOT;
const inside = (parent: string, child: string) => child.toLowerCase().startsWith(`${parent.toLowerCase()}${path.sep}`);
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1500);

function ownedPath(value: string) {
  const full = path.resolve(value);
  if (!inside(privateRoot, full)) throw new Error("Canaries must stay inside this fork's private .rheo directory");
  for (let part = full; ; part = path.dirname(part)) {
    if (
      existsSync(part) &&
      (lstatSync(part).isSymbolicLink() || realpathSync(part).toLowerCase() !== part.toLowerCase())
    ) {
      throw new Error("Canary paths cannot traverse an existing redirect");
    }
    if (path.dirname(part) === part) break;
  }
  return full;
}

/** Finite OS canaries; this never opens a model thread or reads existing authentication files. */
export async function probeSpacesCodex(
  client: SpacesProbeClient,
  options: SpacesProbeOptions,
): Promise<SpacesProbeReport> {
  const results: SpacesProbeResult[] = [];
  const report: SpacesProbeReport = { ready: false, message: "Spaces isolation has not been verified", results };
  if (process.platform !== "win32") {
    results.push({ id: "platform", passed: false, detail: "This probe verifies native Windows only" });
    return report;
  }
  const runId = randomUUID();
  const workspace = ownedPath(options.workspace);
  const home = ownedPath(options.home);
  const probeRoot = ownedPath(options.probeRoot);
  if (inside(workspace, probeRoot) || inside(workspace, home) || workspace === home || workspace === probeRoot) {
    throw new Error("Negative canaries must be outside the permitted workspace");
  }
  if (
    !options.version ||
    !/^[a-f\d]{64}$/i.test(options.executableSha256) ||
    !/^[a-f\d]{64}$/i.test(options.configurationSha256) ||
    !options.permissionProfile
  ) {
    results.push({
      id: "identity-binding",
      passed: false,
      detail: "CLI version, artifact/configuration SHA-256 and named profile are required",
    });
    return report;
  }
  const directory = path.join(probeRoot, runId);
  const otherRoot = path.join(directory, "B");
  const syntheticDb = path.join(directory, "synthetic-db");
  for (const folder of [workspace, home, otherRoot, syntheticDb]) mkdirSync(folder, { recursive: true, mode: 0o700 });
  const nonce = `SPACES_CANARY_${runId}`;
  const files = {
    positive: path.join(workspace, `spaces-positive-${runId}.txt`),
    other: path.join(otherRoot, "private-project.txt"),
    home: path.join(home, `spaces-synthetic-auth-${runId}.txt`),
    db: path.join(syntheticDb, "synthetic-customer-record.txt"),
    outsideWrite: path.join(otherRoot, "must-not-be-created.txt"),
    workspaceWrite: path.join(workspace, `spaces-must-not-write-${runId}.txt`),
  };
  for (const file of [files.positive, files.other, files.home, files.db])
    writeFileSync(file, nonce, { flag: "wx", mode: 0o600 });
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
  const execute = async (
    id: string,
    command: string[],
    verify: (response: { exitCode: number; stdout: string; stderr: string }) => boolean | Promise<boolean>,
    detail: string,
  ) => {
    const processId = randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        client.request("command/exec", {
          command,
          cwd: workspace,
          permissionProfile: options.permissionProfile,
          processId,
          timeoutMs: 6000,
          outputBytesCap: 4096,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Canary RPC exceeded its deadline")), 12_000);
        }),
      ]);
      const response = raw as { exitCode?: unknown; stdout?: unknown; stderr?: unknown } | null;
      if (
        !response ||
        !Number.isInteger(response.exitCode) ||
        typeof response.stdout !== "string" ||
        typeof response.stderr !== "string"
      )
        throw new Error("Invalid command/exec response");
      const value = response as { exitCode: number; stdout: string; stderr: string };
      const passed = await verify(value);
      results.push({
        id,
        passed,
        detail: passed ? detail : `${detail}; exit=${value.exitCode}; ${value.stderr.slice(0, 700)}`,
        exitCode: value.exitCode,
        stdout: value.stdout.slice(0, 4096),
        stderr: value.stderr.slice(0, 4096),
      });
      return value;
    } catch (error) {
      results.push({ id, passed: false, detail: errorText(error) });
      // This id belongs only to this deterministic canary and this client connection.
      await Promise.race([
        client.request("command/exec/terminate", { processId }).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const read = (file: string) => ps(`Get-Content -LiteralPath ${quote(file)} -Raw -ErrorAction Stop`);
  const denied = (response: { exitCode: number; stdout: string; stderr: string }) =>
    response.exitCode !== 0 && !response.stdout.includes(nonce) && !response.stderr.includes(nonce);
  const sockets = new Set<Socket>();
  let server: ReturnType<typeof createServer> | undefined;
  let junction: string | undefined;
  try {
    await execute(
      "read-workspace",
      read(files.positive),
      (r) => r.exitCode === 0 && r.stdout.trim() === nonce,
      "The permitted workspace returned the exact synthetic canary",
    );
    if (results.at(-1)?.passed !== true) {
      report.message = "Positive workspace control failed; confinement cannot be attested";
      return report;
    }
    await execute("read-other-root", read(files.other), denied, "Other project root was unreadable");
    await execute("read-home", read(files.home), denied, "Synthetic home/auth marker was unreadable");
    await execute("read-synthetic-db", read(files.db), denied, "Synthetic database marker was unreadable");
    const write = (file: string) =>
      ps(`Set-Content -LiteralPath ${quote(file)} -Value ${quote(nonce)} -NoNewline -ErrorAction Stop`);
    await execute(
      "write-outside-workspace",
      write(files.outsideWrite),
      (r) => denied(r) && !existsSync(files.outsideWrite),
      "Outside write returned nonzero and created no file",
    );
    await execute(
      "write-workspace",
      write(files.workspaceWrite),
      (r) => denied(r) && !existsSync(files.workspaceWrite),
      "Read-only workspace rejected writes without creating a file",
    );
    const traversal = `${workspace}${path.sep}${path.relative(workspace, files.other)}`;
    await execute("read-traversal", read(traversal), denied, "Parent traversal did not reach another project");
    try {
      junction = path.join(workspace, `spaces-junction-${runId}`);
      symlinkSync(otherRoot, junction, "junction");
      await execute(
        "read-junction",
        read(path.join(junction, "private-project.txt")),
        denied,
        "A workspace junction did not expose the other project",
      );
    } catch (error) {
      junction = undefined;
      results.push({
        id: "read-junction",
        passed: null,
        detail: `Host could not prepare the optional junction fixture: ${errorText(error)}`,
      });
    }
    const nativeClient = await execute(
      "native-network-client",
      [curl, "--version"],
      (r) => r.exitCode === 0 && /\bcurl\b/i.test(r.stdout) && /\btelnet\b/i.test(r.stdout),
      "The native client launches and supports HTTP/TCP protocols",
    );
    if (!nativeClient || results.at(-1)?.passed !== true) {
      report.message = "Native network client control failed; network denial cannot be attested";
      return report;
    }
    let connections = 0;
    let requests = 0;
    server = createServer((_request, response) => {
      requests++;
      response.writeHead(200, { "content-type": "text/plain", connection: "close" });
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
    if (!address || typeof address === "string") throw new Error("The synthetic listener has no TCP port");
    const url = `http://127.0.0.1:${address.port}/spaces-canary/${runId}`;
    const positive = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { connection: "close" } });
    const hostPassed = positive.status === 200 && (await positive.text()) === nonce && connections > 0 && requests > 0;
    results.push({
      id: "host-listener",
      passed: hostPassed,
      detail: "Host HTTP control reached the exact synthetic listener and payload",
    });
    if (!hostPassed) {
      report.message = "Host listener control failed";
      return report;
    }
    for (const [id, endpoint, extra] of [
      ["network-tcp-loopback", `telnet://127.0.0.1:${address.port}`, []],
      ["network-http-loopback", url, []],
      ["network-http-localhost", `http://localhost:${address.port}/spaces-canary/${runId}`, ["--ipv4"]],
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
        "Native connection failed and the host listener observed no new socket or HTTP request",
      );
    }
    report.ready = results.every((result) => result.passed !== false);
    report.message = report.ready
      ? "Spaces named profile passed the finite filesystem/network canaries"
      : "Spaces isolation canaries failed; model execution stays blocked";
    if (report.ready) {
      report.attestation = {
        schemaVersion: 1,
        scope: "command-exec-filesystem-network",
        observedAt: new Date().toISOString(),
        version: options.version,
        executableSha256: options.executableSha256,
        configurationSha256: options.configurationSha256,
        permissionProfile: options.permissionProfile,
        workspace,
        home,
        platform: process.platform,
        osRelease: os.release(),
        results,
        limitations: [
          "Only command/exec filesystem/network confinement is tested; native thread tools and the model client remain separate trust requirements",
          "Finite deterministic canaries, not a proof against every executable or future OS change",
          "No model, login, real credentials, or real customer data used",
          ...results.filter((result) => result.passed === null).map((result) => result.detail),
        ],
      };
    }
    return report;
  } catch (error) {
    results.push({ id: "probe-runtime", passed: false, detail: errorText(error) });
    report.message = "The canary environment could not complete; execution stays blocked";
    return report;
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (junction) unlinkSync(junction);
    for (const file of [files.positive, files.home, files.workspaceWrite]) if (existsSync(file)) unlinkSync(file);
    const evidencePath = path.join(directory, "probe-result.json");
    report.evidencePath = evidencePath;
    writeFileSync(evidencePath, JSON.stringify({ ...report, binding: options }, null, 2), { flag: "wx", mode: 0o600 });
  }
}
