param(
    [string]$Server = '93.127.131.55',
    [string]$SshUser = 'administrator',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Mazao\Backups'),
    [switch]$VerifyRestore,
    [string]$ResumeId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
if ([string]::IsNullOrWhiteSpace($ResumeId)) { $id = [guid]::NewGuid().ToString('N') }
else {
    if ($ResumeId -notmatch '^[0-9a-f]{32}$') { throw 'ResumeId must be the 32-character id of a backup created by this script.' }
    $id = $ResumeId
}
$scratch = Join-Path $env:TEMP ('mazao-backup-' + $id)
$raw = Join-Path $scratch 'database.dump'
$remote = '/srv/mazao/backups/backup-' + $id + '.dump'
$container = 'mazao-restore-' + $id
$sshArgs = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3')
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Check-NativeExit([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

function Download-RemoteFile([string]$RemotePath, [string]$LocalPath, [long]$expectedSize) {
    $ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
    $lastError = 'SSH ended before the complete dump arrived.'
    for ($attempt = 1; $attempt -le 8; $attempt++) {
        $offset = if (Test-Path -LiteralPath $LocalPath) { (Get-Item -LiteralPath $LocalPath).Length } else { 0 }
        if ($offset -gt $expectedSize) { throw 'The local partial dump is larger than the remote dump.' }
        if ($offset -eq $expectedSize) { return }
        $remoteCommand = if ($offset -eq 0) { 'cat -- ' + $RemotePath } else { 'tail -c +' + ($offset + 1) + ' -- ' + $RemotePath }
        $arguments = @(
            '-i', ('"' + $KeyPath + '"'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15',
            '-o', 'ServerAliveCountMax=3', ('"' + $SshUser + '@' + $Server + '"'), ('"' + $remoteCommand + '"')
        ) -join ' '
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $ssh
        $startInfo.Arguments = $arguments
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $process = New-Object System.Diagnostics.Process
        $processStarted = $false
        $output = $null
        try {
            $process.StartInfo = $startInfo
            if (-not $process.Start()) { throw 'Could not start the SSH backup download.' }
            $processStarted = $true
            $stderrTask = $process.StandardError.ReadToEndAsync()
            if ($offset -eq 0) { $output = [System.IO.File]::Create($LocalPath) }
            else { $output = [System.IO.File]::Open($LocalPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read) }
            $process.StandardOutput.BaseStream.CopyTo($output)
            $output.Flush()
            $process.WaitForExit()
            $detail = $stderrTask.GetAwaiter().GetResult().Trim()
            $receivedSize = (Get-Item -LiteralPath $LocalPath).Length
            if ($process.ExitCode -eq 0 -and $receivedSize -eq $expectedSize) { return }
            $lastError = "SSH attempt $attempt ended with exit $($process.ExitCode), local size $receivedSize of $expectedSize bytes. $detail"
        } catch {
            $lastError = $_.Exception.Message
        } finally {
            if ($output) { $output.Dispose() }
            if ($processStarted -and -not $process.HasExited) { try { $process.Kill(); $process.WaitForExit() } catch {} }
            if ($process) { $process.Dispose() }
        }
        if ($attempt -lt 8) { Start-Sleep -Seconds 2 }
    }
    throw "Backup download did not complete after resumable SSH attempts: $lastError"
}

function Get-RemoteFileSize([string]$RemotePath) {
    $output = & ssh @sshArgs "$SshUser@$Server" ('stat -c %s -- ' + $RemotePath)
    Check-NativeExit 'Read remote dump size'
    [long]$size = 0
    if (-not [long]::TryParse((@($output) -join '').Trim(), [ref]$size) -or $size -lt 5) { throw 'Remote dump size was invalid.' }
    return $size
}

function Get-RemoteMigrationState {
    $compose = 'docker compose --project-name mazao --env-file /srv/mazao/.env -f /srv/mazao/compose.yml exec -T db '
    $dbUserOutput = & ssh @sshArgs "$SshUser@$Server" ($compose + 'printenv POSTGRES_USER')
    Check-NativeExit 'Read production database role'
    $dbNameOutput = & ssh @sshArgs "$SshUser@$Server" ($compose + 'printenv POSTGRES_DB')
    Check-NativeExit 'Read production database name'
    $dbUser = (@($dbUserOutput) -join '').Trim()
    $dbName = (@($dbNameOutput) -join '').Trim()
    if ($dbUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $dbName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'Production database identifiers failed validation.' }
    $query = $compose + 'psql -U ' + $dbUser + ' -d ' + $dbName + ' -At -c ''SELECT count(*)::text || chr(58) || max(version) FROM system.schema_migrations'''
    $output = & ssh @sshArgs "$SshUser@$Server" $query
    Check-NativeExit 'Read production migration state'
    $state = (@($output) -join '').Trim()
    $separator = $state.IndexOf(':')
    if ($separator -lt 1) { throw 'Could not read the production migration state.' }
    $count = 0
    if (-not [int]::TryParse($state.Substring(0, $separator), [ref]$count)) { throw 'Production migration count was invalid.' }
    $head = $state.Substring($separator + 1).Trim()
    if ($count -lt 1 -or $head -notmatch '^\d{3}_[a-z0-9_]+$') { throw 'Production migration state was invalid.' }
    return [pscustomobject]@{ count = $count; head = $head }
}

function Restrict-Directory([string]$Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    $directory = [System.IO.DirectoryInfo]::new($Path)
    $acl = $directory.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existing in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existing) }
    $acl.SetAccessRule($rule)
    $directory.SetAccessControl($acl)
}

$createdContainer = $false
$remoteDumpReady = -not [string]::IsNullOrWhiteSpace($ResumeId)
$backupComplete = $false
try {
    Restrict-Directory $scratch
    Restrict-Directory $Destination
    $sourceMigrationState = Get-RemoteMigrationState
    if ($ResumeId) {
        if (-not (Test-Path -LiteralPath $raw)) { throw 'The protected local partial dump for this ResumeId is missing.' }
        $expectedSize = Get-RemoteFileSize $remote
        if ((Get-Item -LiteralPath $raw).Length -gt $expectedSize) { throw 'The protected local partial dump is larger than its remote source.' }
    } else {
        $command = 'set -eu; umask 077; mkdir -p /srv/mazao/backups; docker compose --project-name mazao --env-file /srv/mazao/.env -f /srv/mazao/compose.yml exec -T db sh -c ''pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'' > ' + $remote
        & ssh @sshArgs "$SshUser@$Server" $command
        Check-NativeExit 'Database dump'
        $afterDumpMigrationState = Get-RemoteMigrationState
        if ($sourceMigrationState.count -ne $afterDumpMigrationState.count -or $sourceMigrationState.head -ne $afterDumpMigrationState.head) { throw 'The production schema changed while its backup was being created.' }
        $remoteDumpReady = $true
        $expectedSize = Get-RemoteFileSize $remote
    }
    # Copy bytes through OpenSSH and resume at the last local byte if its
    # read-only transfer connection drops.
    Download-RemoteFile $remote $raw $expectedSize
    $bytes = [System.IO.File]::ReadAllBytes($raw)
    if ($bytes.Length -ne $expectedSize -or $bytes.Length -lt 5 -or [System.Text.Encoding]::ASCII.GetString($bytes, 0, 5) -ne 'PGDMP') { throw 'The downloaded file is incomplete or not a valid PostgreSQL custom-format dump.' }
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $backup = Join-Path $Destination ($stamp + '-' + $id + '.dump.dpapi')
    [System.IO.File]::WriteAllBytes($backup, $encrypted)
    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($backup), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.File]::WriteAllBytes($raw, $decrypted)
    $report = [ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString('o'); server = $Server; encryption = 'Windows DPAPI CurrentUser'; dumpBytes = $bytes.Length; encryptedSha256 = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash; migrationCount = $sourceMigrationState.count; migrationHead = $sourceMigrationState.head; restoreVerified = $false }

    if ($VerifyRestore) {
        & docker run -d --name $container --network none -e POSTGRES_HOST_AUTH_METHOD=trust 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea' | Out-Null
        Check-NativeExit 'Disposable restore container'
        $createdContainer = $true
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            & docker exec $container pg_isready -U postgres *> $null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 1
        }
        Check-NativeExit 'Restore database readiness'
        & docker cp $raw "${container}:/tmp/database.dump"
        Check-NativeExit 'Copy dump into isolated restore container'
        & docker exec $container createdb -U postgres mazao_restore
        Check-NativeExit 'Create restore database'
        & docker exec $container pg_restore --exit-on-error --no-owner --no-acl -U postgres -d mazao_restore /tmp/database.dump
        Check-NativeExit 'Restore encrypted off-host backup'
        $sql = "SELECT json_build_object('migrationCount',(SELECT count(*) FROM system.schema_migrations),'migrationHead',(SELECT version FROM system.schema_migrations ORDER BY version DESC LIMIT 1),'tenantCount',(SELECT count(*) FROM core.tenants),'orderCount',(SELECT count(*) FROM commerce.orders),'journalCount',(SELECT count(*) FROM finance.journal_entries),'unbalancedJournalCount',(SELECT count(*) FROM (SELECT journal_entry_id FROM finance.journal_lines GROUP BY journal_entry_id HAVING sum(debit_minor)<>sum(credit_minor)) bad));"
        $result = & docker exec $container psql -U postgres -d mazao_restore -At -v ON_ERROR_STOP=1 -c $sql
        Check-NativeExit 'Restored database control totals'
        $totals = $result | ConvertFrom-Json
        if ($totals.migrationCount -ne $sourceMigrationState.count -or $totals.migrationHead -ne $sourceMigrationState.head -or $totals.unbalancedJournalCount -ne 0) { throw 'Restored database did not match the live migration state or failed journal integrity checks.' }
        $report.restoreVerified = $true
        $report.controlTotals = $totals
    }

    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ($backup + '.json') -Encoding UTF8
    $backupComplete = $true
    Write-Output ("Backup: " + $backup)
    $report | ConvertTo-Json -Depth 5
} finally {
    if ($createdContainer) {
        try { & docker rm -f -v $container | Out-Null; if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove disposable restore container $container." } }
        catch { Write-Warning "Could not remove disposable restore container ${container}: $($_.Exception.Message)" }
    }
    if ($backupComplete -or -not $remoteDumpReady) {
        $remoteRemoved = $false
        for ($cleanupAttempt = 1; $cleanupAttempt -le 3; $cleanupAttempt++) {
            try {
                & ssh @sshArgs "$SshUser@$Server" "rm -f -- $remote" 2>$null
                if ($LASTEXITCODE -eq 0) { $remoteRemoved = $true; break }
            } catch {}
            if ($cleanupAttempt -lt 3) { Start-Sleep -Seconds 2 }
        }
        if (-not $remoteRemoved) { Write-Warning "Temporary remote dump remains at $remote; the local backup result is not invalidated." }
        try { if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force } }
        catch { Write-Warning "Could not remove restricted local scratch directory ${scratch}: $($_.Exception.Message)" }
    } else {
        Write-Warning "Incomplete dump retained in the restricted local scratch directory $scratch and at $remote. Resume with -ResumeId $id; this partial dump is not a verified backup."
    }
}
