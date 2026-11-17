import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const pwsh = Bun.which("pwsh");
const base = join(root, ".rheo/probes", `release-test-${randomUUID()}`);
const release = join(base, ".rheo/releases/spaces-aaaaaaaaaaaa");
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function run(code: string) {
  if (!pwsh) throw new Error("PowerShell 7 is required");
  const result = Bun.spawnSync([
    pwsh,
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(code, "utf16le").toString("base64"),
  ]);
  return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}
const manifestPath = join(release, "spaces-release.json");
const library = join(release, "scripts/rheo/Stop-Spaces.ps1");
const check = () => run(`. ${quote(library)} -Library; Assert-RheoRelease; Write-Output 'verified'`);

describe.skipIf(process.platform !== "win32" || !pwsh)("frozen Spaces release guards", () => {
  beforeEach(() => {
    if (!pwsh) throw new Error("PowerShell 7 is required");
    rmSync(base, { recursive: true, force: true });
    mkdirSync(join(release, "scripts/rheo"), { recursive: true });
    mkdirSync(join(release, "runtime"));
    cpSync(join(root, "scripts/rheo/Stop-Spaces.ps1"), library);
    writeFileSync(join(release, "runtime/bun.exe"), "synthetic runtime, never executed");
    const files = ["scripts/rheo/Stop-Spaces.ps1", "runtime/bun.exe"].map((path) => ({
      path,
      sha256: sha(join(release, path)),
    }));
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        version: "spaces-aaaaaaaaaaaa",
        sourceCommit: "a".repeat(40),
        installationRoot: base,
        codex: { path: pwsh, sha256: sha(pwsh) },
        files,
      }),
    );
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  test("accepts the exact package", () => {
    const result = check();
    expect(result.code).toBe(0);
    expect(result.output).toContain("verified");
  });
  test("refuses changed executable bytes", () => {
    appendFileSync(join(release, "runtime/bun.exe"), "changed");
    const result = check();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("integrity failed");
  });
  test("refuses unlisted code next to the server", () => {
    writeFileSync(join(release, "extra.js"), "unexpected");
    expect(check().output).toContain("Unexpected release file");
  });
  test("refuses a path escaping the manifest", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files[0].path = "../outside.txt";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(check().output).toContain("Invalid release file entry");
  });
  test("refuses a moved package", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.installationRoot = join(base, "elsewhere");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(check().output).toContain("release was moved");
  });
  test("cannot use the release as a database directory", () => {
    const result = run(`. ${quote(library)} -Library; Resolve-RheoData ${quote(join(release, "data"))}`);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("releases as a data directory");
  });
});
