#requires -Version 7.0
param([string]$DataDirectory)
$requestedData = $DataDirectory
. (Join-Path $PSScriptRoot 'Stop-Spaces.ps1') -Library

try {
    $data = Resolve-RheoData $requestedData
    $context = Get-RheoContext
    if (-not (Test-Path -LiteralPath $data -PathType Container)) { throw 'The fork data directory does not exist.' }
    $guard = [IO.File]::Open((Join-Path $data '.rheo-start.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    if (Get-RheoRuntime $data) { throw 'Refusing a live backup. Stop the fork gracefully first, then run Backup and Start.' }
    if (Test-Path -LiteralPath (Join-Path $data 'server.lock')) { throw 'Refusing a backup while a native server lock exists.' }
    if (-not (Test-Path -LiteralPath (Join-Path $data 'db') -PathType Container)) { throw 'The fork data directory has no database folder.' }
    if (-not (Test-Path -LiteralPath (Join-Path $data '.env') -PathType Leaf)) { throw 'The installation .env is required to preserve encrypted credentials.' }
    $databaseLock = Enter-RheoDatabaseLock $data
    $parts = @('db', 'files', '.env', 'owner-key', 'host-computer-token') | Where-Object { Test-Path -LiteralPath (Join-Path $data $_) }
    $files = @()
    $directories = @()
    foreach ($part in $parts) {
        $source = Join-Path $data $part
        [void](Resolve-RheoPath $source)
        $items = @(Get-Item -Force -LiteralPath $source)
        if ($items[0].PSIsContainer) { $items += @(Get-ChildItem -Force -LiteralPath $source -Recurse) }
        foreach ($item in $items) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a reparse point in the backup tree.' }
            if ($item.PSIsContainer) { $directories += [IO.Path]::GetRelativePath($data, $item.FullName).Replace('\', '/') }
            else { $files += $item.FullName }
        }
    }
    $backupRoot = Join-Path $context.privateRoot 'backups'
    [void](Resolve-RheoPath $backupRoot)
    Set-RheoPrivateDirectory $backupRoot
    $backup = Join-Path $backupRoot ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N'))
    Set-RheoPrivateDirectory $backup
    $entries = @()
    foreach ($file in $files) {
        $relative = 'data/' + [IO.Path]::GetRelativePath($data, $file).Replace('\', '/')
        $target = Join-Path $backup $relative
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
        [IO.File]::Copy($file, $target, $false)
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash -ne $hash) { throw 'A copied backup file failed verification.' }
        $entries += @{ path = $relative; sha256 = $hash }
    }
    [void][IO.Directory]::CreateDirectory((Join-Path $backup 'metadata'))
    foreach ($pair in @(
        @{ source = $context.originManifest; name = 'origin-manifest.json' },
        @{ source = (Join-Path $context.root 'apps/server/package.json'); name = 'server-package.json' }
    )) {
        $target = Join-Path $backup ('metadata/' + $pair.name)
        [IO.File]::Copy($pair.source, $target, $false)
        $entries += @{ path = ('metadata/' + $pair.name); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash }
    }
    $identity = @{
        nativeSourceSha256 = (Get-FileHash -LiteralPath $context.nativeEntry -Algorithm SHA256).Hash
        runtimeSha256 = (Get-FileHash -LiteralPath $context.executable -Algorithm SHA256).Hash
        webIndexSha256 = $null
        gitHead = (& git -C $context.root rev-parse HEAD)
        workingTreeDirty = (@(& git -C $context.root status --porcelain).Count -gt 0)
        codeIncluded = $false
    }
    if (Test-Path -LiteralPath (Join-Path $context.web 'index.html')) { $identity.webIndexSha256 = (Get-FileHash -LiteralPath (Join-Path $context.web 'index.html') -Algorithm SHA256).Hash }
    $identityFile = Join-Path $backup 'metadata/code-identity.json'
    Write-RheoJson $identityFile $identity
    $entries += @{ path = 'metadata/code-identity.json'; sha256 = (Get-FileHash -LiteralPath $identityFile -Algorithm SHA256).Hash }
    $manifest = @{
        schemaVersion = 1; kind = 'rheo-spaces-cold-backup'; createdAt = [DateTime]::UtcNow.ToString('o')
        sourceDataDirectory = $data; files = $entries; directories = $directories
        confidentiality = 'unencrypted; private Windows ACL; includes credentials; keep outside Git'
        recoveryPoint = 'Stopped fork files at the time this backup was made; no automatic backup schedule.'
    }
    Write-RheoJson (Join-Path $backup 'backup-manifest.json') $manifest
    [pscustomobject]@{ status = 'verified'; backupPath = $backup; files = $entries.Count; createdAt = $manifest.createdAt; privateAcl = $true; encrypted = $false } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally {
    if (Get-Variable databaseLock -ErrorAction SilentlyContinue) { Exit-RheoDatabaseLock $databaseLock }
    if ((Get-Variable guard -ErrorAction SilentlyContinue) -and $null -ne $guard) { $guard.Dispose() }
}
