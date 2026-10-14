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
$sshArgs = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Check-NativeExit([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

function Restrict-Directory([string]$Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

Restrict-Directory $scratch
Restrict-Directory $Destination
$createdContainer = $false
try {
    $command = "set -eu; umask 077; mkdir -p /srv/mazao/backups; docker compose --project-name mazao --env-file /srv/mazao/.env -f /srv/mazao/compose.yml exec -T db sh -c 'pg_dump -U `\"`$POSTGRES_USER`\" -d `\"`$POSTGRES_DB`\" -Fc' > $remote"
    & ssh @sshArgs "$SshUser@$Server" $command
    Check-NativeExit 'Database dump'
    & scp @sshArgs "${SshUser}@${Server}:$remote" $raw
    Check-NativeExit 'Backup download'

    $bytes = [System.IO.File]::ReadAllBytes($raw)
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $backup = Join-Path $Destination ($stamp + '-' + $id + '.dump.dpapi')
    [System.IO.File]::WriteAllBytes($backup, $encrypted)
    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($backup), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.File]::WriteAllBytes($raw, $decrypted)
    $report = [ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString('o'); server = $Server; encryption = 'Windows DPAPI CurrentUser'; encryptedSha256 = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash; restoreVerified = $false }

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
        $sql = "SELECT json_build_object('migrationCount',(SELECT count(*) FROM system.schema_migrations),'tenantCount',(SELECT count(*) FROM core.tenants),'orderCount',(SELECT count(*) FROM commerce.orders),'journalCount',(SELECT count(*) FROM finance.journal_entries),'unbalancedJournalCount',(SELECT count(*) FROM (SELECT journal_entry_id FROM finance.journal_lines GROUP BY journal_entry_id HAVING sum(debit_minor)<>sum(credit_minor)) bad));"
        $result = & docker exec $container psql -U postgres -d mazao_restore -At -v ON_ERROR_STOP=1 -c $sql
        Check-NativeExit 'Restored database control totals'
        $totals = $result | ConvertFrom-Json
        if ($totals.migrationCount -lt 13 -or $totals.unbalancedJournalCount -ne 0) { throw 'Restored database failed migration or journal integrity checks.' }
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
