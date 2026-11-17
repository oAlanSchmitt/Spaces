#requires -Version 7.0
param([string]$DataDirectory, [switch]$Worker, [string]$LaunchId)
$requestedData = $DataDirectory
. (Join-Path $PSScriptRoot 'Stop-Spaces.ps1') -Library
$DataDirectory = Resolve-RheoData $requestedData
$context = Get-RheoContext
$statePath = Join-Path $DataDirectory '.rheo-runtime.json'
$stopPath = Join-Path $DataDirectory '.rheo-stop-request.json'

function Start-RheoWorker {
    $child = $null
    $outputs = @()
    $graceful = $false
    try {
        $launchGuid = [guid]::Empty
        if (-not $LaunchId -or -not [guid]::TryParse($LaunchId, [ref]$launchGuid)) { throw 'Invalid launch identity.' }
        $info = [Diagnostics.ProcessStartInfo]::new()
        $info.FileName = $context.executable
        $info.Arguments = '--no-env-file "' + $context.nativeEntry + '" --data "' + $DataDirectory + '" --until-stdin-ends'
        $info.WorkingDirectory = $context.root
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        # A clean child environment prevents inherited owner/host tokens, provider keys and other server settings.
        $info.Environment.Clear()
        foreach ($key in @('HOME', 'USERPROFILE', 'PATH', 'SystemRoot', 'WINDIR', 'ProgramFiles', 'ProgramData', 'OS', 'PROCESSOR_ARCHITECTURE', 'SystemDrive', 'COMSPEC', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'LANG', 'TZ')) {
            $value = [Environment]::GetEnvironmentVariable($key, 'Process')
            if ($null -ne $value) { $info.Environment[$key] = $value }
        }
        foreach ($entry in @{
            BUN_BE_BUN = '1'; WEB_DIR = $context.web; PORT = '4410'; PUBLIC_URL = 'http://localhost:4410'
            TELEMETRY = 'off'; INSTALL_MODE = 'native'; MACHINE_PROVISIONING = 'off'
        }.GetEnumerator()) { $info.Environment[$entry.Key] = $entry.Value }
        $info.Environment['SOURCE_URL'] = 'https://github.com/oAlanSchmitt/Spaces'
        if ($context.releaseDirectory) {
            $info.Environment['APP_VERSION'] = $context.release.version
            $info.Environment['SOURCE_URL'] = "https://github.com/oAlanSchmitt/Spaces/tree/$($context.release.sourceCommit)"
            $info.Environment['PATH'] = [IO.Path]::GetDirectoryName($context.release.codex.path) + ';' + $info.Environment['PATH']
        }
        $child = [Diagnostics.Process]::Start($info)
        foreach ($stream in @(@{ name = 'stdout'; source = $child.StandardOutput.BaseStream }, @{ name = 'stderr'; source = $child.StandardError.BaseStream })) {
            $file = [IO.File]::Open((Join-Path $DataDirectory "logs/launcher-$($stream.name).log"), [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            $outputs += @{ file = $file; task = $stream.source.CopyToAsync($file) }
        }
        $supervisor = Get-Process -Id $PID
        $state = @{
            schemaVersion = 1; root = $context.root; dataDirectory = $DataDirectory; executable = $context.executable
            nativeEntry = $context.nativeEntry; arguments = @('--no-env-file', $context.nativeEntry, '--data', $DataDirectory, '--until-stdin-ends')
            pid = $child.Id; startTicks = $child.StartTime.ToUniversalTime().Ticks.ToString(); launchId = $LaunchId
            supervisorPid = $PID; supervisorExecutable = $supervisor.Path; supervisorStartTicks = $supervisor.StartTime.ToUniversalTime().Ticks.ToString()
            origin = 'http://localhost:4410'; port = 4410; startedAt = [DateTime]::UtcNow.ToString('o')
        }
        Write-RheoJson $statePath $state
        while (-not $child.HasExited) {
            if (Test-Path -LiteralPath $stopPath) {
                [void](Resolve-RheoPath $stopPath)
                $request = Get-Content -LiteralPath $stopPath -Raw | ConvertFrom-Json
                if ($request.launchId -eq $LaunchId -and -not $graceful) {
                    $child.StandardInput.Close()
                    $graceful = $true
                }
            }
            Start-Sleep -Milliseconds 200
        }
        foreach ($output in $outputs) { $output.task.GetAwaiter().GetResult() }
        Write-RheoJson (Join-Path $DataDirectory '.rheo-last-exit.json') @{
            launchId = $LaunchId; pid = $child.Id; exitCode = $child.ExitCode; gracefulRequested = $graceful; exitedAt = [DateTime]::UtcNow.ToString('o')
        }
    } catch {
        # Closing this supervisor's stdin pipe is the native Windows shutdown contract; never kill by PID.
        if ($child -and -not $child.HasExited) { $child.StandardInput.Close() }
        [IO.File]::WriteAllText((Join-Path $DataDirectory 'logs/launcher-error.log'), $_.Exception.Message)
    } finally {
        foreach ($output in $outputs) { $output.file.Dispose() }
        if (Test-Path -LiteralPath $statePath) {
            $current = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
            if ($current.launchId -eq $LaunchId -and (-not $child -or $child.HasExited)) { Remove-Item -LiteralPath $statePath }
        }
        if ($child) { $child.Dispose() }
    }
}

try {
    Assert-RheoRelease
    if (Test-Path -LiteralPath (Join-Path $DataDirectory '.rheo-recovery-hold.json')) { throw 'Recovery hold: review restored jobs, credentials and code compatibility before explicitly releasing this directory.' }
    foreach ($path in @($context.executable, $context.nativeEntry, (Join-Path $context.web 'index.html'), $context.originManifest)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required pilot file is missing: $path" }
    }
    [void](Resolve-RheoPath $context.executable)
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $context.executable).Hash -ne (Get-Content -LiteralPath $context.originManifest -Raw | ConvertFrom-Json).runtime.sha256) {
        throw 'The private runtime differs from the recorded Bun artifact.'
    }
    if ($Worker) { Start-RheoWorker; return }
    Set-RheoPrivateDirectory $context.privateRoot
    Set-RheoPrivateDirectory $DataDirectory
    [void][IO.Directory]::CreateDirectory((Join-Path $DataDirectory 'logs'))
    $guard = [IO.File]::Open((Join-Path $DataDirectory '.rheo-start.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if (Test-Path -LiteralPath (Join-Path $DataDirectory '.rheo-recovery-hold.json')) { throw 'Recovery hold: review restored jobs, credentials and code compatibility before explicitly releasing this directory.' }
        $current = Get-RheoRuntime $DataDirectory
        if ($current) { throw 'The fork is already running in this data directory.' }
        if (Test-Path -LiteralPath (Join-Path $DataDirectory 'server.lock')) { throw 'A native server lock exists; reconcile the private fork state before starting.' }
        $probe = Enter-RheoDatabaseLock $DataDirectory
        Exit-RheoDatabaseLock $probe
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 4410)
        try { $listener.Start() } finally { $listener.Stop() }
        if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath }
        $LaunchId = [guid]::NewGuid().ToString()
        $shell = (Get-Process -Id $PID).Path
        $arguments = @('-NoProfile', '-NonInteractive', '-File', ('"' + $PSCommandPath + '"'), '-Worker', '-DataDirectory', ('"' + $DataDirectory + '"'), '-LaunchId', $LaunchId)
        $supervisor = Start-Process -FilePath $shell -ArgumentList $arguments -WorkingDirectory $context.root -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($supervisor.HasExited) { throw 'The pilot supervisor exited; inspect the private launcher logs.' }
            $current = Get-RheoRuntime $DataDirectory -SkipReady
            if ($current -and $current.launchId -eq $LaunchId -and (Test-Path -LiteralPath (Join-Path $DataDirectory 'server.json'))) {
                try {
                    $ready = Get-Content -LiteralPath (Join-Path $DataDirectory 'server.json') -Raw | ConvertFrom-Json
                    if ($ready.pid -ne $current.pid -or $ready.publicUrl -ne $current.origin) { Start-Sleep -Milliseconds 200; continue }
                    $response = Invoke-WebRequest -Uri 'http://localhost:4410/api/health' -TimeoutSec 3 -UseBasicParsing
                    if ($response.StatusCode -eq 200) {
                        [pscustomobject]@{ status = 'ready'; pid = $current.pid; origin = $current.origin; dataDirectory = $DataDirectory; telemetry = 'off'; hostRunner = 'not-started' } | ConvertTo-Json -Compress
                        return
                    }
                } catch { }
            }
            Start-Sleep -Milliseconds 400
        }
        Write-RheoJson $stopPath @{ launchId = $LaunchId }
        throw 'Pilot startup exceeded 90 seconds; graceful shutdown requested. Inspect private logs before retrying.'
    } finally { $guard.Dispose() }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
