import { afterAll, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { codexIsolatedThreadMatches } from "../runner/brain-codex-app";
import { probeSpacesWork, runSpacesWorkCanaries } from "../src/spaces-work-probe";

const repository = path.resolve(import.meta.dir, "../../..");
const fixture = path.join(repository, ".spaces-work-tests", `probe-unit-${randomUUID()}`);
const home = path.join(repository, ".rheo/probes", `work-probe-home-${randomUUID()}`);
const options = () => {
  const workspace = path.join(fixture, randomUUID());
  mkdirSync(workspace, { recursive: true });
  mkdirSync(home, { recursive: true });
  return {
    workspace,
    home,
    version: "test-cli",
    executableSha256: "a".repeat(64),
    configurationSha256: "b".repeat(64),
    permissionProfile: "spaces-work",
    hostId: "c".repeat(64),
  };
};
afterAll(() => {
  if (fixture.startsWith(`${path.join(repository, ".spaces-work-tests")}${path.sep}`))
    rmSync(fixture, { recursive: true, force: true });
  if (home.startsWith(`${path.join(repository, ".rheo/probes")}${path.sep}`))
    rmSync(home, { recursive: true, force: true });
});
const suite = process.platform === "win32" ? describe : describe.skip;
test("rejects the old launch fingerprint before starting a client when runtime policy is missing", async () => {
  const expected = options();
  const command = path.join(home, "non-executable-fixture.txt");
  const bytes = "synthetic executable identity only";
  writeFileSync(command, bytes);
  const launch = { args: ["app-server"], env: {} };
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  expected.executableSha256 = hash(bytes);
  expected.configurationSha256 = hash(
    JSON.stringify({ args: launch.args, env: launch.env, workspace: expected.workspace }),
  );
  await expect(probeSpacesWork(expected, { command, launch })).rejects.toThrow("launch configuration changed");
});
test("verifies the named thread profile without trusting the legacy projection", () => {
  const expected = options();
  const settings = {
    activePermissionProfile: { id: "spaces-work", extends: null },
    cwd: expected.workspace,
    runtimeWorkspaceRoots: [expected.workspace],
    thread: {
      environments: [{ environmentId: "local", cwd: expected.workspace, runtimeWorkspaceRoots: [expected.workspace] }],
    },
    sandbox: { type: "readOnly", networkAccess: false },
    approvalPolicy: "never",
    modelProvider: "openai",
    instructionSources: [],
  };
  expect(codexIsolatedThreadMatches(settings, expected.permissionProfile, expected.workspace)).toBe(true);
  for (const changed of [
    { activePermissionProfile: { id: ":workspace" } },
    { activePermissionProfile: { id: "spaces-work", extends: ":workspace" } },
    { cwd: home },
    { runtimeWorkspaceRoots: [] },
    { runtimeWorkspaceRoots: [home] },
    { runtimeWorkspaceRoots: [expected.workspace, home] },
    { sandbox: { networkAccess: true } },
    { approvalPolicy: "on-request" },
    { modelProvider: "another provider" },
    { instructionSources: ["host instructions"] },
    { thread: { environments: [] } },
    {
      thread: {
        environments: [
          { environmentId: "remote", cwd: expected.workspace, runtimeWorkspaceRoots: [expected.workspace] },
        ],
      },
    },
    { thread: { environments: [{ environmentId: "local", cwd: home, runtimeWorkspaceRoots: [expected.workspace] }] } },
    { thread: { environments: [{ environmentId: "local", cwd: expected.workspace, runtimeWorkspaceRoots: [home] }] } },
  ])
    expect(
      codexIsolatedThreadMatches({ ...settings, ...changed }, expected.permissionProfile, expected.workspace),
    ).toBe(false);
});
suite("Spaces work OS canaries", () => {
  test("rejects total denial rather than attesting confinement", async () => {
    const result = await runSpacesWorkCanaries(
      { request: async () => ({ exitCode: 1, stdout: "", stderr: "denied" }) },
      options(),
    );
    expect(result.ready).toBe(false);
    expect(result.attestation).toBeUndefined();
    expect(result.results[0]?.id).toBe("read-workspace");
    expect(result.results[0]?.passed).toBe(false);
  });
  test("rejects a successful write response without the actual file effect", async () => {
    const client = {
      request: async (_method: string, input: unknown) => {
        const command = (input as { command: string[] }).command;
        const script = Buffer.from(command.at(-1) ?? "", "base64").toString("utf16le");
        const match = script.match(/Get-Content -LiteralPath '([^']+)'/);
        return { exitCode: 0, stdout: match?.[1] ? readFileSync(match[1], "utf8") : "", stderr: "" };
      },
    };
    const result = await runSpacesWorkCanaries(client, options());
    expect(result.results.find((check) => check.id === "read-workspace")?.passed).toBe(true);
    expect(result.results.find((check) => check.id === "write-workspace")?.passed).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.attestation).toBeUndefined();
  });
});
