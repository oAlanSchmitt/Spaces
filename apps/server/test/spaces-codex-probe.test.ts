import { afterAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { probeSpacesCodex } from "../src/spaces-codex-probe";

const root = path.resolve(import.meta.dir, "../../..");
const fixtures = path.join(root, ".rheo/probes", `unit-${randomUUID()}`);
const suite = process.platform === "win32" ? describe : describe.skip;
const options = (name: string) => {
  const base = path.join(fixtures, name);
  const result = {
    workspace: path.join(base, "A"),
    home: path.join(base, "home"),
    probeRoot: path.join(base, "records"),
    version: "test-cli",
    executableSha256: "a".repeat(64),
    configurationSha256: "b".repeat(64),
    permissionProfile: "spaces-closed",
  };
  mkdirSync(result.workspace, { recursive: true });
  mkdirSync(result.home, { recursive: true });
  return result;
};

afterAll(() => {
  const prefix = path.join(root, ".rheo/probes") + path.sep;
  if (path.resolve(fixtures).startsWith(prefix)) rmSync(fixtures, { recursive: true, force: true });
});

suite("Spaces Codex OS canaries", () => {
  test("rejects a transport that denies everything instead of proving positive access", async () => {
    const result = await probeSpacesCodex(
      { request: async () => ({ exitCode: 1, stdout: "", stderr: "denied" }) },
      options("all-denied"),
    );
    expect(result.ready).toBe(false);
    expect(result.attestation).toBeUndefined();
    expect(result.results.some((check) => check.id === "read-workspace" && check.passed === false)).toBe(true);
  });

  test("detects real reads and writes when an unconfined transport lies outside the profile", async () => {
    const client = {
      request: async (method: string, input: unknown) => {
        if (method !== "command/exec") return {};
        const params = input as { command: string[]; cwd: string; permissionProfile: string };
        expect(params.permissionProfile).toBe("spaces-closed");
        return new Promise((resolve) => {
          execFile(
            params.command[0] ?? "",
            params.command.slice(1),
            { cwd: params.cwd, windowsHide: true, timeout: 8000, maxBuffer: 8192 },
            (error, stdout, stderr) => {
              resolve({ exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0, stdout, stderr });
            },
          );
        });
      },
    };
    const result = await probeSpacesCodex(client, options("unconfined"));
    expect(result.ready).toBe(false);
    expect(result.attestation).toBeUndefined();
    expect(result.results.find((check) => check.id === "read-other-root")?.passed).toBe(false);
    expect(result.results.find((check) => check.id === "write-outside-workspace")?.passed).toBe(false);
  }, 60_000);
});
