import { afterAll, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openPglite } from "../../packages/db/src/pglite";

const root = resolve(import.meta.dir, "../..");
const fixtures = join(root, ".rheo", "tests", `runtime-${randomUUID()}`);
const backups: string[] = [];
const powershell = Bun.which("pwsh") ?? Bun.which("powershell");
const suite = process.platform === "win32" && powershell ? describe : describe.skip;
let junctionSupported = false;
if (process.platform === "win32") {
  const target = join(fixtures, "junction-probe-target");
  mkdirSync(target, { recursive: true });
  try {
    symlinkSync(target, join(fixtures, "junction-probe"), "junction");
    junctionSupported = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }
}
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const call = (script: string, args: string[]) => {
  if (!powershell) throw new Error("PowerShell is required on Windows");
  const result = Bun.spawnSync(
    [powershell, "-NoProfile", "-NonInteractive", "-File", join(root, "scripts/rheo", script), ...args],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return { code: result.exitCode, output: `${result.stdout}\n${result.stderr}` };
};
const fixture = (name: string) => {
  const data = join(fixtures, name);
  mkdirSync(join(data, "db"), { recursive: true });
  mkdirSync(join(data, "db", "empty-required-directory"), { recursive: true });
  mkdirSync(join(data, "files", "nested"), { recursive: true });
  writeFileSync(join(data, "db", "synthetic.bin"), new Uint8Array([0, 1, 127, 255]));
  writeFileSync(join(data, "files", "nested", "note.txt"), "synthetic document\n");
  writeFileSync(join(data, ".env"), "AGENTES_SECRET=synthetic-secret-do-not-print\n");
  writeFileSync(join(data, "owner-key"), "synthetic-owner-do-not-print");
  return data;
};

afterAll(() => {
  for (const backup of backups) {
    if (backup.startsWith(`${join(root, ".rheo", "backups")}\\`)) rmSync(backup, { recursive: true, force: true });
  }
  // Only this test's known, generated fixture tree is removed.
  if (fixtures.startsWith(`${join(root, ".rheo", "tests")}\\`)) rmSync(fixtures, { recursive: true, force: true });
});

suite("Spaces native maintenance", () => {
  test("a closed PGlite database restores and reopens despite its persistent lock file", async () => {
    const data = join(fixtures, "pglite");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, ".env"), "AGENTES_SECRET=synthetic-pglite-secret\n");
    const original = openPglite(join(data, "db"));
    try {
      await original.ready;
      await original.pg.exec(
        "create table rheo_restore_probe (project text, body text); insert into rheo_restore_probe values ('synthetic-alpha', 'preserved β');",
      );
      const live = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
      expect(live.code).not.toBe(0);
    } finally {
      await original.pg.close();
    }
    expect(existsSync(join(data, "db.lock"))).toBe(true);
    const backup = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
    expect(backup.code, backup.output).toBe(0);
    const receipt = JSON.parse(backup.output.trim());
    backups.push(receipt.backupPath);
    const destination = join(fixtures, "pglite-restored");
    const result = call("Restore-Spaces.ps1", ["-BackupPath", receipt.backupPath, "-Destination", destination]);
    expect(result.code, result.output).toBe(0);
    const restored = openPglite(join(destination, "db"));
    try {
      await restored.ready;
      expect((await restored.pg.query("select project, body from rheo_restore_probe")).rows).toEqual([
        { project: "synthetic-alpha", body: "preserved β" },
      ]);
    } finally {
      await restored.pg.close();
    }
  }, 60_000);

  test("backup and restore preserve database bytes, uploads and private configuration", () => {
    const data = fixture("roundtrip");
    const original = digest(join(data, "db", "synthetic.bin"));
    const backup = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
    expect(backup.code, backup.output).toBe(0);
    expect(backup.output).not.toContain("synthetic-secret-do-not-print");
    expect(backup.output).not.toContain("synthetic-owner-do-not-print");
    const receipt = JSON.parse(backup.output.trim());
    backups.push(receipt.backupPath);
    const destination = join(fixtures, "restored");
    const restored = call("Restore-Spaces.ps1", ["-BackupPath", receipt.backupPath, "-Destination", destination]);
    expect(restored.code, restored.output).toBe(0);
    expect(existsSync(join(destination, ".rheo-recovery-hold.json"))).toBe(true);
    const held = call("Start-Spaces.ps1", ["-DataDirectory", destination]);
    expect(held.code).not.toBe(0);
    expect(held.output).toContain("Recovery hold");
    expect(existsSync(join(destination, ".rheo-runtime.json"))).toBe(false);
    expect(digest(join(destination, "db", "synthetic.bin"))).toBe(original);
    expect(existsSync(join(destination, "db", "empty-required-directory"))).toBe(true);
    expect(digest(join(data, "db", "synthetic.bin"))).toBe(original);
    expect(readFileSync(join(destination, "files", "nested", "note.txt"), "utf8")).toBe("synthetic document\n");
    expect(readFileSync(join(destination, ".env"), "utf8")).toBe("AGENTES_SECRET=synthetic-secret-do-not-print\n");
    expect(readFileSync(join(destination, "owner-key"), "utf8")).toBe("synthetic-owner-do-not-print");
    expect(existsSync(join(receipt.backupPath, "metadata", "origin-manifest.json"))).toBe(true);
    const refused = call("Restore-Spaces.ps1", ["-BackupPath", receipt.backupPath, "-Destination", destination]);
    expect(refused.code).not.toBe(0);
    expect(digest(join(destination, "db", "synthetic.bin"))).toBe(original);
  }, 30_000);

  test("backup refuses a database lock and paths outside the fork's private tree", () => {
    const data = fixture("locked");
    writeFileSync(join(data, "server.lock"), "synthetic lock");
    const locked = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
    expect(locked.code).not.toBe(0);
    expect(locked.output).toContain("lock exists");
    const outside = call("Backup-Spaces.ps1", ["-DataDirectory", join(root, "apps")]);
    expect(outside.code).not.toBe(0);
    expect(outside.output).toContain("outside the fork private");
    expect(existsSync(join(root, "apps", ".rheo-runtime.json"))).toBe(false);
  }, 15_000);

  test("restore rejects tampering before creating its destination", () => {
    const data = fixture("tampering");
    const backup = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
    expect(backup.code, backup.output).toBe(0);
    const receipt = JSON.parse(backup.output.trim());
    backups.push(receipt.backupPath);
    writeFileSync(join(receipt.backupPath, "data", "db", "synthetic.bin"), "changed");
    const destination = join(fixtures, "must-not-exist");
    expect(call("Restore-Spaces.ps1", ["-BackupPath", receipt.backupPath, "-Destination", destination]).code).not.toBe(
      0,
    );
    expect(existsSync(destination)).toBe(false);
  }, 20_000);

  test("restore owns the destination lock and preserves recovery hold when copied bytes fail verification", async () => {
    if (!powershell) throw new Error("PowerShell is required on Windows");
    const data = fixture("restore-write-failure");
    const backup = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
    expect(backup.code, backup.output).toBe(0);
    const receipt = JSON.parse(backup.output.trim());
    backups.push(receipt.backupPath);
    const destination = join(fixtures, "restore-write-failure-result");
    const paused = join(fixtures, "restore-copy-paused");
    const release = join(fixtures, "restore-copy-release");
    // Inject actual byte corruption only after the real copy; no production hook or fake hash result.
    const command = `
      $global:restoreAuditTriggered = $false
      function global:Get-FileHash {
        param([string]$Algorithm, [string]$LiteralPath)
        if (-not $global:restoreAuditTriggered -and $LiteralPath.StartsWith(${psQuote(`${destination}\\`)})) {
          $global:restoreAuditTriggered = $true
          [IO.File]::WriteAllText(${psQuote(paused)}, 'paused')
          $deadline = [DateTime]::UtcNow.AddSeconds(15)
          while (-not (Test-Path -LiteralPath ${psQuote(release)})) {
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Synthetic release timed out' }
            Start-Sleep -Milliseconds 25
          }
          [IO.File]::AppendAllText($LiteralPath, 'synthetic-corruption')
        }
        Microsoft.PowerShell.Utility\\Get-FileHash -Algorithm $Algorithm -LiteralPath $LiteralPath
      }
      & ${psQuote(join(root, "scripts/rheo/Restore-Spaces.ps1"))} -BackupPath ${psQuote(receipt.backupPath)} -Destination ${psQuote(destination)}
      exit $LASTEXITCODE
    `;
    const injectedScript = join(fixtures, "restore-copy-injection.ps1");
    writeFileSync(injectedScript, command);
    const child = Bun.spawn([powershell, "-NoProfile", "-NonInteractive", "-File", injectedScript], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    let holdDuringCopy = false;
    let concurrentLockBlocked = false;
    try {
      const deadline = Date.now() + 12_000;
      while (!existsSync(paused) && Date.now() < deadline) await Bun.sleep(25);
      if (!existsSync(paused))
        throw new Error(`Restore injection did not reach its post-copy marker; exit=${child.exitCode}`);
      holdDuringCopy = existsSync(join(destination, ".rheo-recovery-hold.json"));
      const lock = Bun.spawnSync(
        [
          powershell,
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `
        try {
          $guard = [IO.File]::Open(${psQuote(join(destination, ".rheo-start.lock"))}, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
          $guard.Dispose(); 'unprotected'
        } catch [IO.IOException] { 'blocked' }
      `,
        ],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
      );
      concurrentLockBlocked = lock.exitCode === 0 && lock.stdout.toString().trim() === "blocked";
    } finally {
      writeFileSync(release, "release");
    }
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("restored file failed verification");
    expect(holdDuringCopy).toBe(true);
    expect(concurrentLockBlocked).toBe(true);
    expect(existsSync(join(destination, ".rheo-recovery-hold.json"))).toBe(true);
    expect(existsSync(join(destination, ".rheo-runtime.json"))).toBe(false);
  }, 30_000);

  test("start rechecks recovery hold after acquiring its maintenance guard", () => {
    if (!powershell) throw new Error("PowerShell is required on Windows");
    const data = fixture("late-recovery-hold");
    // The sentinel guarantees this test cannot launch a server even before the fix.
    writeFileSync(join(data, "server.lock"), "synthetic-do-not-start");
    const command = `
      function global:Get-FileHash {
        param([string]$Algorithm, [string]$LiteralPath)
        [IO.File]::WriteAllText(${psQuote(join(data, ".rheo-recovery-hold.json"))}, '{}')
        Microsoft.PowerShell.Utility\\Get-FileHash -Algorithm $Algorithm -LiteralPath $LiteralPath
      }
      & ${psQuote(join(root, "scripts/rheo/Start-Spaces.ps1"))} -DataDirectory ${psQuote(data)}
      exit $LASTEXITCODE
    `;
    const injectedScript = join(fixtures, "late-recovery-hold-injection.ps1");
    writeFileSync(injectedScript, command);
    const result = Bun.spawnSync([powershell, "-NoProfile", "-NonInteractive", "-File", injectedScript], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Recovery hold");
    expect(existsSync(join(data, ".rheo-runtime.json"))).toBe(false);
  }, 60_000);

  test("stop rejects an unrelated live process without signalling or killing it", () => {
    const data = fixture("foreign-process");
    writeFileSync(
      join(data, ".rheo-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        root,
        dataDirectory: data,
        pid: process.pid,
        startTicks: "1",
        executable: join(root, ".rheo/runtime/bun.exe"),
        nativeEntry: join(root, "apps/server/src/native.ts"),
        origin: "http://localhost:4410",
        port: 4410,
        launchId: randomUUID(),
      }),
    );
    const result = call("Stop-Spaces.ps1", ["-DataDirectory", data]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("birth time differs");
    expect(existsSync(join(data, ".rheo-stop-request.json"))).toBe(false);
    expect(process.kill(process.pid, 0)).toBe(true);
  }, 15_000);

  test.skipIf(!junctionSupported)(
    "backup rejects a junction instead of copying files through it",
    () => {
      const data = fixture("junction");
      const target = join(fixtures, "separate-owner");
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, "private.txt"), "must not be followed");
      symlinkSync(target, join(data, "db", "redirected"), "junction");
      const result = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("reparse point");
      expect(readFileSync(join(target, "private.txt"), "utf8")).toBe("must not be followed");
    },
    15_000,
  );

  test("restore rejects path traversal in a manifest before writing anything", () => {
    const data = fixture("traversal");
    const backup = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
    expect(backup.code, backup.output).toBe(0);
    const receipt = JSON.parse(backup.output.trim());
    backups.push(receipt.backupPath);
    const file = join(receipt.backupPath, "backup-manifest.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.files.push({ path: "data/db/../../outside.txt", sha256: "0".repeat(64) });
    writeFileSync(file, JSON.stringify(manifest));
    const destination = join(fixtures, "traversal-must-not-exist");
    const result = call("Restore-Spaces.ps1", ["-BackupPath", receipt.backupPath, "-Destination", destination]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("unsafe or duplicate");
    expect(existsSync(destination)).toBe(false);
  }, 20_000);

  test("backup and restore refuse to lose the installation encryption secret", () => {
    const data = fixture("missing-env");
    unlinkSync(join(data, ".env"));
    const missing = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
    expect(missing.code).not.toBe(0);
    expect(missing.output).toContain(".env");
    writeFileSync(join(data, ".env"), "AGENTES_SECRET=synthetic-encryption-secret\n");
    const backup = call("Backup-Spaces.ps1", ["-DataDirectory", data]);
    expect(backup.code, backup.output).toBe(0);
    const receipt = JSON.parse(backup.output.trim());
    backups.push(receipt.backupPath);
    const file = join(receipt.backupPath, "backup-manifest.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.files = manifest.files.filter((entry: { path: string }) => entry.path !== "data/.env");
    writeFileSync(file, JSON.stringify(manifest));
    unlinkSync(join(receipt.backupPath, "data", ".env"));
    const destination = join(fixtures, "missing-env-must-not-exist");
    const restored = call("Restore-Spaces.ps1", ["-BackupPath", receipt.backupPath, "-Destination", destination]);
    expect(restored.code).not.toBe(0);
    expect(restored.output).toContain(".env");
    expect(existsSync(destination)).toBe(false);
  }, 25_000);

  test("private storage has exactly owner and SYSTEM grants after an attempted extra grant", () => {
    if (!powershell) throw new Error("PowerShell is required on Windows");
    const directory = join(fixtures, "acl");
    mkdirSync(directory, { recursive: true });
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const command = `
      . ${quote(join(root, "scripts/rheo/Stop-Spaces.ps1"))} -Library
      $directory = ${quote(directory)}
      & icacls.exe $directory /grant '*S-1-1-0:(OI)(CI)F' | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare explicit ACL fixture' }
      $before = @((Get-Acl -LiteralPath $directory).Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
      Set-RheoPrivateDirectory $directory
      @{ before = $before; owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; rules = @((Get-Acl -LiteralPath $directory).Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }) } | ConvertTo-Json -Compress
    `;
    const result = Bun.spawnSync(
      [
        powershell,
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const acl = JSON.parse(result.stdout.toString());
    // The sandbox may silently suppress the fixture grant; exact final permissions still matter.
    expect(acl.rules.sort()).toEqual([acl.owner, "S-1-5-18"].sort());
  }, 15_000);
});
