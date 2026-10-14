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
    $origin = 'https://mazao.davemusau.co.ke'
    $body = @{ email = $AdminEmail.ToLowerInvariant(); password = $password } | ConvertTo-Json -Compress
    $login = Invoke-RestMethod -Uri ($origin + '/api/v1/auth/login') -Method Post -ContentType 'application/json' -Headers @{ Origin = $origin } -Body $body -SessionVariable mazSession
    if ($login.tenant.name -ne $TenantName -or $login.outlet.name -ne $OutletName) { throw 'Sign-in returned unexpected tenant or outlet details.' }
    $me = Invoke-RestMethod -Uri ($origin + '/api/v1/auth/me') -WebSession $mazSession
    if ($me.user.email -ne $AdminEmail.ToLowerInvariant()) { throw 'Session verification returned an unexpected administrator.' }
    $reportDate = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'E. Africa Standard Time').ToString('yyyy-MM-dd')
    foreach ($path in @('/catalog/items', '/shifts/current', ('/reports/trial-balance?asOf=' + $reportDate))) {
        Invoke-RestMethod -Uri ($origin + '/api/v1' + $path) -WebSession $mazSession | Out-Null
    }
    Invoke-RestMethod -Uri ($origin + '/api/v1/auth/logout') -Method Post -WebSession $mazSession -Headers @{ Origin = $origin; 'x-csrf-token' = $login.csrfToken } | Out-Null
    Write-Host 'HTTPS sign-in, session, catalog, shift and trial balance reads verified.'
    Write-Host 'Initial administrator created. Sign in at https://mazao.davemusau.co.ke.'
} finally {
    $password = $null
    $confirmation = $null
    $config = $null
    $body = $null
    $login = $null
    $me = $null
    $mazSession = $null
    $secret.Dispose()
    $confirm.Dispose()
}
