#requires -Version 7.0
param([Parameter(Mandatory)][string]$BackupPath, [Parameter(Mandatory)][string]$Destination)
. (Join-Path $PSScriptRoot 'Stop-Spaces.ps1') -Library

try {
    $backup = Resolve-RheoPath $BackupPath
    $destinationPath = Resolve-RheoData $Destination
    $context = Get-RheoContext
    $backupPrefix = (Join-Path $context.privateRoot 'backups') + [IO.Path]::DirectorySeparatorChar
    if (-not $backup.StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing a restore source outside .rheo/backups.' }
    if (Test-Path -LiteralPath $destinationPath) { throw 'Refusing to overwrite an existing restore destination.' }
    $manifestPath = Join-Path $backup 'backup-manifest.json'
    [void](Resolve-RheoPath $manifestPath)
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.kind -ne 'rheo-spaces-cold-backup') { throw 'Unsupported backup manifest.' }
    $actualItems = @(Get-ChildItem -LiteralPath $backup -Recurse -Force)
    foreach ($item in $actualItems) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a reparse point in the backup tree.' }
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $manifest.files) {
        if ($entry.path -notmatch '^(data/(db/|files/|\.env$|owner-key$|host-computer-token$)|metadata/(origin-manifest|server-package|code-identity)\.json$)' -or
            $entry.path -match '(^|/)\.\.(/|$)|[:\\]' -or -not $seen.Add($entry.path)) { throw 'Refusing an unsafe or duplicate backup member.' }
        $source = [IO.Path]::GetFullPath((Join-Path $backup $entry.path))
        if (-not $source.StartsWith($backup + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash -ne $entry.sha256) { throw 'Backup integrity verification failed.' }
    }
    foreach ($directory in $manifest.directories) {
        if ($directory -notmatch '^(db|files)(/[^/]+)*$' -or $directory -match '(^|/)\.\.(/|$)|[:\\]') { throw 'Refusing an unsafe backup directory.' }
    }
    if (-not $seen.Contains('data/.env')) { throw 'The installation .env is missing from the verified backup.' }
    if ('db' -notin $manifest.directories) { throw 'The backup has no database folder.' }
    $actualFiles = @($actualItems | Where-Object { -not $_.PSIsContainer })
    foreach ($file in $actualFiles) {
        $relative = [IO.Path]::GetRelativePath($backup, $file.FullName).Replace('\', '/')
        if ($relative -ne 'backup-manifest.json' -and -not $seen.Contains($relative)) { throw 'The backup contains an unlisted file.' }
    }
    Set-RheoPrivateDirectory $destinationPath
    $guard = [IO.File]::Open((Join-Path $destinationPath '.rheo-start.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    if (Get-RheoRuntime $destinationPath) { throw 'Refusing to restore into a concurrently started fork.' }
    if (Test-Path -LiteralPath (Join-Path $destinationPath 'server.lock')) { throw 'Refusing to restore while a native server lock exists at the destination.' }
    Write-RheoJson (Join-Path $destinationPath '.rheo-recovery-hold.json') @{
        reason = 'Restored jobs, routines, credentials and version compatibility require review before any server workers start.'
        backupCreatedAt = $manifest.createdAt; restoredAt = [DateTime]::UtcNow.ToString('o')
    }
    foreach ($directory in $manifest.directories) { [void][IO.Directory]::CreateDirectory((Join-Path $destinationPath $directory)) }
    foreach ($entry in $manifest.files) {
        if (-not $entry.path.StartsWith('data/')) { continue }
        $target = Join-Path $destinationPath $entry.path.Substring(5)
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
        [IO.File]::Copy((Join-Path $backup $entry.path), $target, $false)
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash -ne $entry.sha256) { throw 'A restored file failed verification; the new partial directory was retained for inspection.' }
    }
    [pscustomobject]@{ status = 'restored-verified'; dataDirectory = $destinationPath; backupCreatedAt = $manifest.createdAt; started = $false; recoveryHold = $true } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally { if ((Get-Variable guard -ErrorAction SilentlyContinue) -and $null -ne $guard) { $guard.Dispose() } }
