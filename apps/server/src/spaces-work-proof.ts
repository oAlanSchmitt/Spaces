import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SpacesProbeResult } from "./spaces-codex-probe";

export interface SpacesWorkProofIdentity {
  home: string;
  workspace: string;
  version: string;
  executableSha256: string;
  configurationSha256: string;
  permissionProfile: string;
  hostId: string;
}
export const SPACES_WORK_CHECKS = [
  "thread-policy",
  "read-workspace",
  "write-workspace",
  "execute-test",
  "read-other-root",
  "read-home",
  "read-synthetic-db",
  "write-outside-workspace",
  "read-traversal",
  "read-junction",
  "native-network-client",
  "host-listener",
  "network-tcp-loopback",
  "network-http-loopback",
  "network-http-localhost",
] as const;
export interface SpacesWorkProof extends SpacesWorkProofIdentity {
  schemaVersion: 2;
  scope: "work-command-exec-filesystem-network";
  observedAt: string;
  platform: string;
  osRelease: string;
  hostname: string;
  results: SpacesProbeResult[];
  limitations: string[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const key = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
export const spacesWorkProofPath = (home: string, workspace: string) =>
  path.join(
    home,
    "work-proofs",
    `${createHash("sha256")
      .update(key(path.resolve(workspace)))
      .digest("hex")}.json`,
  );

/** This private host record attests commands only, not model tools, images or account entitlement. */
export function validateSpacesWorkProof(value: unknown, expected: SpacesWorkProofIdentity, now = Date.now()): boolean {
  if (
    !object(value) ||
    value.schemaVersion !== 2 ||
    value.scope !== "work-command-exec-filesystem-network" ||
    value.platform !== process.platform ||
    value.osRelease !== os.release() ||
    value.hostname !== os.hostname() ||
    expected.permissionProfile !== "spaces-work" ||
    !expected.version ||
    !path.isAbsolute(expected.workspace) ||
    !path.isAbsolute(expected.home) ||
    ![expected.executableSha256, expected.configurationSha256, expected.hostId].every((digest) =>
      /^[a-f\d]{64}$/i.test(digest),
    )
  )
    return false;
  for (const field of [
    "home",
    "workspace",
    "version",
    "executableSha256",
    "configurationSha256",
    "permissionProfile",
    "hostId",
  ] as const)
    if (value[field] !== expected[field]) return false;
  const observed = typeof value.observedAt === "string" ? Date.parse(value.observedAt) : NaN;
  if (
    !Number.isFinite(observed) ||
    observed > now ||
    !Array.isArray(value.results) ||
    value.results.length !== SPACES_WORK_CHECKS.length
  )
    return false;
  const results = value.results;
  return SPACES_WORK_CHECKS.every(
    (id) =>
      results.filter(
        (result: unknown) =>
          object(result) && result.id === id && result.passed === true && typeof result.detail === "string",
      ).length === 1,
  );
}

async function canonical(value: string, directory: boolean) {
  const full = path.resolve(value);
  const info = await lstat(full);
  return (
    !info.isSymbolicLink() &&
    (directory ? info.isDirectory() : info.isFile()) &&
    key(await realpath(full)) === key(full)
  );
}
export async function readSpacesWorkProof(expected: SpacesWorkProofIdentity): Promise<boolean> {
  try {
    const file = spacesWorkProofPath(expected.home, expected.workspace);
    if (
      !(await canonical(expected.home, true)) ||
      !(await canonical(expected.workspace, true)) ||
      !(await canonical(file, false)) ||
      (await lstat(file)).size > 128_000
    )
      return false;
    return validateSpacesWorkProof(JSON.parse(await readFile(file, "utf8")), expected);
  } catch {
    return false;
  }
}

export async function saveSpacesWorkProof(proof: SpacesWorkProof): Promise<void> {
  if (!validateSpacesWorkProof(proof, proof)) throw new Error("Cannot save incomplete work confinement evidence");
  const file = spacesWorkProofPath(proof.home, proof.workspace);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (
    !(await canonical(proof.home, true)) ||
    !(await canonical(proof.workspace, true)) ||
    !(await canonical(directory, true))
  )
    throw new Error("Work proof directories cannot be redirected");
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(proof, null, 2), { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
