#requires -Version 7.0
param([string]$DataDirectory, [switch]$Library)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:RheoContextCache = $null

# Shared guards stay here so every maintenance command uses the same boundary.
function Get-RheoContext {
    if ($script:RheoContextCache) { return $script:RheoContextCache }
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $release = Join-Path $root 'spaces-release.json'
    if (Test-Path -LiteralPath $release -PathType Leaf) {
        $manifest = Get-Content -LiteralPath $release -Raw | ConvertFrom-Json
        if ($manifest.schemaVersion -ne 1 -or $manifest.sourceCommit -notmatch '^[a-f0-9]{40}$' -or
            $manifest.version -notmatch '^spaces-[a-f0-9]{12}$' -or -not [IO.Path]::IsPathFullyQualified($manifest.installationRoot)) {
            throw 'Invalid Spaces release manifest.'
        }
        $installation = [IO.Path]::GetFullPath($manifest.installationRoot)
        if ($root -ne (Join-Path $installation ".rheo/releases/$($manifest.version)")) { throw 'The Spaces release was moved; use its original installation folder.' }
        $script:RheoContextCache = [pscustomobject]@{
            root = $installation; privateRoot = Join-Path $installation '.rheo'
            executable = Join-Path $root 'runtime/bun.exe'; nativeEntry = Join-Path $root 'server/native.js'
            web = Join-Path $root 'web'; originManifest = $release; releaseDirectory = $root; release = $manifest
        }
        return $script:RheoContextCache
    }
    $script:RheoContextCache = [pscustomobject]@{
        root = $root
        privateRoot = Join-Path $root '.rheo'
        executable = Join-Path $root '.rheo/runtime/bun.exe'
        nativeEntry = Join-Path $root 'apps/server/src/native.ts'
        web = Join-Path $root 'apps/web/dist'
        originManifest = Join-Path $root 'docs/rheo-spaces/origin-manifest.json'
        releaseDirectory = $null; release = $null
    }
    $script:RheoContextCache
}

function Assert-RheoRelease {
    $context = Get-RheoContext
    if (-not $context.releaseDirectory) { return }
    [void](Resolve-RheoPath $context.releaseDirectory)
    $expected = @{}
    foreach ($entry in $context.release.files) {
        if (-not $entry.path -or $entry.path -match '(^/|\\|:|(^|/)\.\.?(/|$))' -or $entry.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid release file entry.' }
        if ($expected.ContainsKey($entry.path)) { throw 'Duplicate release file entry.' }
        $expected[$entry.path] = $entry.sha256
    }
    # The root's ancestors are checked once; enumeration checks every descendant without following links.
    foreach ($file in Get-ChildItem -LiteralPath $context.releaseDirectory -Recurse -Force) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a reparse point in the Spaces release.' }
        if (-not $file.PSIsContainer) {
            $relative = [IO.Path]::GetRelativePath($context.releaseDirectory, $file.FullName).Replace('\', '/')
            if ($relative -eq 'spaces-release.json') { continue }
            if (-not $expected.ContainsKey($relative)) { throw "Unexpected release file: $relative" }
            if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $expected[$relative]) {
                throw "Spaces release integrity failed: $relative"
            }
            $expected.Remove($relative)
        }
    }
    if ($expected.Count) { throw "Spaces release integrity failed: $($expected.Count) missing file(s): $($expected.Keys -join ', ')" }
    if ($context.release.codex.path) {
        if (-not (Test-Path -LiteralPath $context.release.codex.path -PathType Leaf) -or
            (Get-FileHash -LiteralPath $context.release.codex.path -Algorithm SHA256).Hash -ne $context.release.codex.sha256) {
            throw 'The pinned Codex executable is missing or changed. Revalidate Codex before rebuilding this release.'
        }
    }
}

function Resolve-RheoPath([string]$Path) {
    $context = Get-RheoContext
    if (-not [IO.Path]::IsPathRooted($Path)) { $Path = Join-Path $context.root $Path }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]'\/')
    if (-not $full.StartsWith($context.privateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing a path outside the fork private .rheo directory.'
    }
    $ancestor = $full
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            if ((Get-Item -Force -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Refusing a reparse point in the maintenance path.'
            }
        }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
    $full
}

function Resolve-RheoData([string]$Path) {
    if (-not $Path) { $Path = Join-Path (Get-RheoContext).privateRoot 'data' }
    $full = Resolve-RheoPath $Path
    $relative = [IO.Path]::GetRelativePath((Get-RheoContext).privateRoot, $full)
    if (($relative -split '[\\/]')[0] -in @('runtime', 'backups', 'releases')) { throw 'Refusing to use runtime, backups or releases as a data directory.' }
    $full
}

function Set-RheoPrivateDirectory([string]$Path) {
    [void][IO.Directory]::CreateDirectory($Path)
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
    # Preserve owner/audit metadata: replacing the whole descriptor can require SeSecurityPrivilege.
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        [void]$acl.RemoveAccessRuleSpecific($rule)
    }
    foreach ($sid in @($owner, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        [void]$acl.AddAccessRule($rule)
    }
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path), $acl)
}

function Write-RheoJson([string]$Path, $Value) {
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12))
    [IO.File]::Move($temporary, $Path, $true)
}

function Enter-RheoDatabaseLock([string]$DataPath) {
    $context = Get-RheoContext
    [void](Resolve-RheoPath $context.executable)
    $lockPath = Resolve-RheoPath (Join-Path $DataPath 'db.lock')
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $context.executable
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.Environment.Clear()
    $info.Environment['BUN_BE_BUN'] = '1'
    foreach ($key in @('SystemRoot', 'USERPROFILE', 'TEMP', 'TMP')) {
        $value = [Environment]::GetEnvironmentVariable($key, 'Process')
        if ($null -ne $value) { $info.Environment[$key] = $value }
    }
    # Match packages/db/src/pglite.ts: the SQLite file persists; its OS lock is the actual exclusion.
    $program = @'
import { Database } from 'bun:sqlite';
const db = new Database(Bun.argv[1], { create: true });
db.exec('PRAGMA journal_mode = MEMORY');
db.exec('BEGIN IMMEDIATE');
process.stdin.on('end', () => { db.close(); process.exit(0); });
process.stdin.resume();
console.log('locked');
'@
    foreach ($argument in @('--no-env-file', '-e', $program, $lockPath)) { $info.ArgumentList.Add($argument) }
    $helper = [Diagnostics.Process]::Start($info)
    $line = $helper.StandardOutput.ReadLineAsync()
    if (-not $line.Wait(5000) -or $line.Result -ne 'locked') {
        if (-not $helper.HasExited) { $helper.StandardInput.Close(); [void]$helper.WaitForExit(5000) }
        $helper.Dispose()
        throw 'The database lock is held or cannot be verified; no database files were copied.'
    }
    $helper
}

function Exit-RheoDatabaseLock($Helper) {
    if ($null -eq $Helper) { return }
    try {
        if (-not $Helper.HasExited) { $Helper.StandardInput.Close() }
        if (-not $Helper.WaitForExit(5000)) { throw 'The private database lock helper has not exited; inspect before starting the fork.' }
    } finally { $Helper.Dispose() }
}

function Get-RheoRuntime([string]$DataPath, [switch]$SkipReady) {
    $context = Get-RheoContext
    $statePath = Join-Path $DataPath '.rheo-runtime.json'
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    [void](Resolve-RheoPath $statePath)
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.schemaVersion -ne 1 -or $state.root -ne $context.root -or $state.dataDirectory -ne $DataPath -or
        $state.executable -ne $context.executable -or $state.nativeEntry -ne $context.nativeEntry -or
        $state.origin -ne 'http://localhost:4410' -or $state.port -ne 4410) {
        throw 'Refusing runtime metadata for a different target.'
    }
    $child = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if (-not $child) { return $null }
    if ($child.Path -ne $context.executable -or $child.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.startTicks) {
        throw 'Refusing a process whose executable or birth time differs.'
    }
    $supervisor = Get-Process -Id $state.supervisorPid -ErrorAction SilentlyContinue
    if (-not $supervisor -or $supervisor.Path -ne $state.supervisorExecutable -or
        $supervisor.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.supervisorStartTicks) {
        throw 'Refusing a process without its original stdin supervisor.'
    }
    $readyPath = Join-Path $DataPath 'server.json'
    if (-not $SkipReady -and (Test-Path -LiteralPath $readyPath)) {
        [void](Resolve-RheoPath $readyPath)
        $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
        if ($ready.pid -ne $state.pid -or $ready.publicUrl -ne $state.origin) { throw 'Refusing conflicting native readiness metadata.' }
    }
    $state
}

function Stop-RheoRuntime([string]$DataPath) {
    $state = Get-RheoRuntime $DataPath
    if (-not $state) {
        if (Test-Path -LiteralPath (Join-Path $DataPath 'server.lock')) {
            throw 'Refusing to report stopped while an unmanaged native lock exists.'
        }
        if (Test-Path -LiteralPath $DataPath -PathType Container) {
            $probe = Enter-RheoDatabaseLock $DataPath
            Exit-RheoDatabaseLock $probe
        }
        return [pscustomobject]@{ status = 'already-stopped'; dataDirectory = $DataPath }
    }
    $request = Join-Path $DataPath '.rheo-stop-request.json'
    [void](Resolve-RheoPath $request)
    Write-RheoJson $request @{ launchId = $state.launchId }
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        $child = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
        if (-not $child -or $child.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.startTicks) {
            $receiptPath = Join-Path $DataPath '.rheo-last-exit.json'
            if (Test-Path -LiteralPath $receiptPath) {
                [void](Resolve-RheoPath $receiptPath)
                $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
                if ($receipt.launchId -eq $state.launchId) {
                    if ($receipt.exitCode -ne 0 -or -not $receipt.gracefulRequested) { throw 'The fork exited without a confirmed clean shutdown; inspect its private logs.' }
                    return [pscustomobject]@{ status = 'stopped'; graceful = $true; pid = $state.pid; dataDirectory = $DataPath }
                }
            }
        }
        Start-Sleep -Milliseconds 200
    }
    throw 'Clean shutdown was not confirmed within 60 seconds. No process was forcibly terminated.'
}

if ($Library) { return }
try {
    $data = Resolve-RheoData $DataDirectory
    if (Test-Path -LiteralPath $data -PathType Container) {
        $guard = [IO.File]::Open((Join-Path $data '.rheo-start.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    }
    Stop-RheoRuntime $data | ConvertTo-Json -Compress
}
catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally { if (Get-Variable guard -ErrorAction SilentlyContinue) { $guard.Dispose() } }
