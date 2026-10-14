param(
    [Parameter(Mandatory)][string]$AdminEmail,
    [string]$ExpectedTenant,
    [string]$ExpectedOutlet,
    [string]$Origin = 'https://mazao.davemusau.co.ke'
)
$ErrorActionPreference = 'Stop'
$login = $null
$mazSession = $null
$secret = Read-Host 'Existing Mazao application password (verification only)' -AsSecureString
try {
    $password = [System.Net.NetworkCredential]::new('', $secret).Password
    $body = @{ email = $AdminEmail.ToLowerInvariant(); password = $password } | ConvertTo-Json -Compress
    $login = Invoke-RestMethod -Uri ($Origin + '/api/v1/auth/login') -Method Post -ContentType 'application/json' -Headers @{ Origin = $Origin } -Body $body -SessionVariable mazSession
    if ($ExpectedTenant -and $login.tenant.name -ne $ExpectedTenant) { throw 'Sign-in returned an unexpected tenant.' }
    if ($ExpectedOutlet -and $login.outlet.name -ne $ExpectedOutlet) { throw 'Sign-in returned an unexpected outlet.' }
    $me = Invoke-RestMethod -Uri ($Origin + '/api/v1/auth/me') -WebSession $mazSession
    if ($me.user.email -ne $AdminEmail.ToLowerInvariant()) { throw 'Session verification returned an unexpected administrator.' }
    $catalog = Invoke-RestMethod -Uri ($Origin + '/api/v1/catalog/items') -WebSession $mazSession
    $shift = Invoke-RestMethod -Uri ($Origin + '/api/v1/shifts/current') -WebSession $mazSession
    $date = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'E. Africa Standard Time').ToString('yyyy-MM-dd')
    $report = Invoke-RestMethod -Uri ($Origin + '/api/v1/reports/trial-balance?asOf=' + $date) -WebSession $mazSession
    if (!$report.totals.balanced) { throw 'Trial balance returned an imbalance.' }
    $evidence = @{ state='passed'; checkedAt=[DateTime]::UtcNow.ToString('o'); asOf=$date; catalogItemCount=@($catalog.items).Count; openShift=($null -ne $shift.shift); balanced=$report.totals.balanced }
    $path = Join-Path $env:LOCALAPPDATA 'Mazao\Operations\verification-status.json'
    $evidence | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8
    Write-Host 'HTTPS sign-in, session, catalog, shift, and trial balance verified.'
    Write-Host ('Sign in at ' + $Origin)
} finally {
    if ($login -and $mazSession) {
        Invoke-RestMethod -Uri ($Origin + '/api/v1/auth/logout') -Method Post -WebSession $mazSession -Headers @{ Origin=$Origin; 'x-csrf-token'=$login.csrfToken } | Out-Null
    }
    $body = $null
    $password = $null
    $login = $null
    $mazSession = $null
    $me = $null
    $secret.Dispose()
}
