param(
    [Parameter(Mandatory)][string]$TenantName,
    [Parameter(Mandatory)][string]$OutletName,
    [Parameter(Mandatory)][string]$AdminName,
    [Parameter(Mandatory)][string]$AdminEmail,
    [string]$Currency = 'KES',
    [string]$TimeZone = 'Africa/Nairobi',
    [string]$Server = '93.127.131.55',
    [string]$SshUser = 'administrator',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519')
)
$ErrorActionPreference = 'Stop'
$sshArgs = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
Write-Host "Creating $TenantName / $OutletName for $AdminName ($AdminEmail)."
Write-Host 'Enter a new Mazao application password here. It will be sent through SSH stdin and will not be written to a file or command argument.'
$secret = Read-Host 'New application password (at least 12 characters)' -AsSecureString
$confirm = Read-Host 'Confirm application password' -AsSecureString
$password = [System.Net.NetworkCredential]::new('', $secret).Password
$confirmation = [System.Net.NetworkCredential]::new('', $confirm).Password
if ($password.Length -lt 12 -or $password -ne $confirmation) { throw 'Passwords must match and contain at least 12 characters.' }
try {
    $config = @{
        BOOTSTRAP_CONFIRM = 'CREATE_INITIAL_TENANT'
        TENANT_NAME = $TenantName
        TENANT_CURRENCY = $Currency
        TENANT_TIME_ZONE = $TimeZone
        OUTLET_NAME = $OutletName
        OUTLET_TIME_ZONE = $TimeZone
        ADMIN_EMAIL = $AdminEmail.ToLowerInvariant()
        ADMIN_NAME = $AdminName
        ADMIN_PASSWORD = $password
        DEVICE_LABEL = 'Pilot browser'
        TENANT_CAPABILITIES = 'retail,inventory,commerce'
    }
    $config | ConvertTo-Json -Compress | & ssh @sshArgs "$SshUser@$Server" 'bash /srv/mazao/bootstrap-initial-tenant.sh'
    if ($LASTEXITCODE -ne 0) { throw "Initial bootstrap failed (exit $LASTEXITCODE)." }
    Write-Host 'Initial administrator created. Sign in at https://mazao.davemusau.co.ke.'
} finally {
    $password = $null
    $confirmation = $null
    $config = $null
    $secret.Dispose()
    $confirm.Dispose()
}
