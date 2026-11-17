#requires -Version 7.0
param([switch]$Stop, [switch]$Check)
. (Join-Path $PSScriptRoot 'Stop-Spaces.ps1') -Library
try {
    $context = Get-RheoContext
    if (-not $context.releaseDirectory) { throw 'Open Spaces from a built, versioned release.' }
    $data = Resolve-RheoData (Join-Path $context.privateRoot 'pilot-data')
    if ($Stop) {
        $global:LASTEXITCODE = 0
        & (Join-Path $PSScriptRoot 'Stop-Spaces.ps1') -DataDirectory $data
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Spaces did not confirm a clean stop.' }
        return
    }
    Assert-RheoRelease
    if ($Check) {
        [pscustomobject]@{ status = 'verified'; version = $context.release.version; sourceCommit = $context.release.sourceCommit } | ConvertTo-Json -Compress
        return
    }
    $current = Get-RheoRuntime $data
    if (-not $current) {
        $global:LASTEXITCODE = 0
        & (Join-Path $PSScriptRoot 'Start-Spaces.ps1') -DataDirectory $data
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Spaces failed to start. See pilot-data/logs.' }
        $current = Get-RheoRuntime $data
    }
    if (-not $current) { throw 'Spaces did not confirm its process identity.' }
    $health = Invoke-RestMethod -Uri 'http://localhost:4410/api/health' -TimeoutSec 5
    if ($health.status -ne 'ok' -or $health.version -ne $context.release.version) { throw 'Port 4410 belongs to another version or is not ready.' }
    [pscustomobject]@{ status = 'ready'; version = $health.version; pid = $current.pid; origin = $current.origin } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
