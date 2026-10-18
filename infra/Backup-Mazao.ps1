param(
    [string]$Server = '93.127.131.55',
    [string]$SshUser = 'administrator',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Mazao\Backups'),
    [switch]$VerifyRestore
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$id = [guid]::NewGuid().ToString('N')
$scratch = Join-Path $env:TEMP ('mazao-backup-' + $id)
$raw = Join-Path $scratch 'database.dump'
$remote = '/srv/mazao/backups/backup-' + $id + '.dump'
$container = 'mazao-restore-' + $id
$sshArgs = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3')
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Check-NativeExit([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
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
try {
    Restrict-Directory $scratch
    Restrict-Directory $Destination
    $sourceMigrationState = Get-RemoteMigrationState
    $command = 'set -eu; umask 077; mkdir -p /srv/mazao/backups; docker compose --project-name mazao --env-file /srv/mazao/.env -f /srv/mazao/compose.yml exec -T db sh -c ''pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'' > ' + $remote
    & ssh @sshArgs "$SshUser@$Server" $command
    Check-NativeExit 'Database dump'
    $afterDumpMigrationState = Get-RemoteMigrationState
    if ($sourceMigrationState.count -ne $afterDumpMigrationState.count -or $sourceMigrationState.head -ne $afterDumpMigrationState.head) { throw 'The production schema changed while its backup was being created.' }
    $downloadCommand = 'base64 -w0 -- ' + $remote
    $encodedDump = & ssh @sshArgs "$SshUser@$Server" $downloadCommand
    Check-NativeExit 'Backup download'
    try { $bytes = [System.Convert]::FromBase64String((@($encodedDump) -join '').Trim()) }
    catch { throw 'The downloaded backup could not be decoded safely.' }
    [System.IO.File]::WriteAllBytes($raw, $bytes)

    $bytes = [System.IO.File]::ReadAllBytes($raw)
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $backup = Join-Path $Destination ($stamp + '-' + $id + '.dump.dpapi')
    [System.IO.File]::WriteAllBytes($backup, $encrypted)
    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($backup), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.File]::WriteAllBytes($raw, $decrypted)
    $report = [ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString('o'); server = $Server; encryption = 'Windows DPAPI CurrentUser'; encryptedSha256 = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash; migrationCount = $sourceMigrationState.count; migrationHead = $sourceMigrationState.head; restoreVerified = $false }

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
    Write-Output ("Backup: " + $backup)
    $report | ConvertTo-Json -Depth 5
} finally {
    & ssh @sshArgs "$SshUser@$Server" "rm -f -- $remote" 2>$null
    if ($createdContainer) { & docker rm -f -v $container | Out-Null }
    if (Test-Path -LiteralPath $raw) { Remove-Item -LiteralPath $raw -Force }
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Force }
}
