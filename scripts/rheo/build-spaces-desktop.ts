/** A local, frozen release. No credentials or application data enter the package. */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildFolders } from "../native-package";

const root = resolve(import.meta.dir, "../..");
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function command(args: string[]) {
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(`${args[0]} failed: ${result.stderr.toString()}${result.stdout.toString()}`);
  return result.stdout.toString().trim();
}
if (process.platform !== "win32") throw new Error("This launcher is built for the local Windows PC.");
if (command(["git", "status", "--porcelain"])) throw new Error("Commit the audited changes before freezing a release.");
const commit = command(["git", "rev-parse", "HEAD"]);
const version = `spaces-${commit.slice(0, 12)}`;
const privateRoot = join(root, ".rheo");
const release = join(privateRoot, "releases", version);
if (existsSync(release)) throw new Error("This frozen release already exists; do not overwrite it.");
const runtime = join(privateRoot, "runtime/bun.exe");
const recorded = JSON.parse(readFileSync(join(root, "docs/rheo-spaces/origin-manifest.json"), "utf8"));
if (hash(runtime).toLowerCase() !== recorded.runtime.sha256.toLowerCase())
  throw new Error("Bun does not match the audited runtime.");
const codex = Bun.which("codex");
const pwsh = Bun.which("pwsh");
if (!codex || !pwsh) throw new Error("The validated Codex and PowerShell 7 must be installed.");
const compiler = join(process.env.SystemRoot ?? "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
if (!existsSync(compiler)) throw new Error("The Windows .NET Framework compiler is unavailable.");
const staging = join(privateRoot, "staging", crypto.randomUUID());
const built = await buildFolders(staging, version, privateRoot);
mkdirSync(dirname(release), { recursive: true });
renameSync(built, release);
mkdirSync(join(release, "runtime"));
cpSync(runtime, join(release, "runtime/bun.exe"));
mkdirSync(join(release, "scripts/rheo"), { recursive: true });
for (const name of ["Start-Spaces.ps1", "Stop-Spaces.ps1", "Open-Spaces.ps1"])
  cpSync(join(root, "scripts/rheo", name), join(release, "scripts/rheo", name));
const files: { path: string; sha256: string }[] = [];
function inventory(folder: string, prefix = "") {
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected package link: ${relative}`);
    if (entry.isDirectory()) inventory(join(folder, entry.name), `${relative}/`);
    else files.push({ path: relative, sha256: hash(join(folder, entry.name)) });
  }
}
inventory(release);
const manifest = {
  schemaVersion: 1,
  version,
  sourceCommit: commit,
  installationRoot: root,
  dataDirectory: join(privateRoot, "pilot-data"),
  origin: "http://localhost:4410",
  sourceUrl: `https://github.com/oAlanSchmitt/Spaces/tree/${commit}`,
  runtime: { sha256: hash(runtime) },
  codex: { path: codex, sha256: hash(codex), version: command([codex, "--version"]) },
  powershell: {
    path: pwsh,
    version: command([pwsh, "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]),
  },
  files,
};
const manifestFile = join(release, "spaces-release.json");
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
const literals: Record<string, string> = {
  __RELEASE__: release,
  __MANIFEST_HASH__: hash(manifestFile),
  __SCRIPT_HASH__: hash(join(release, "scripts/rheo/Open-Spaces.ps1")),
  __LIBRARY_HASH__: hash(join(release, "scripts/rheo/Stop-Spaces.ps1")),
  __POWERSHELL__: pwsh,
  __VERSION__: version,
};
const source = readFileSync(join(root, "scripts/rheo/SpacesLauncher.cs"), "utf8").replace(
  /__(?:RELEASE|MANIFEST_HASH|SCRIPT_HASH|LIBRARY_HASH|POWERSHELL|VERSION)__/g,
  (token) => JSON.stringify(literals[token]),
);
const generated = join(staging, "SpacesLauncher.cs");
writeFileSync(generated, source);
const executable = join(privateRoot, "releases", `Spaces-${commit.slice(0, 12)}.exe`);
command([
  compiler,
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Drawing.dll",
  `/win32icon:${join(root, "apps/web/public/favicon.ico")}`,
  `/out:${executable}`,
  generated,
]);
console.log(
  JSON.stringify({ version, commit, release, executable, sha256: hash(executable), files: files.length }, null, 2),
);
