# scripts/moncash/helpers.ps1
# Fonctions réutilisables pour tester l'intégration MonCash depuis PowerShell.

# ---------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------

function Get-ApiBaseUrl {
    param([string]$BaseUrl = "http://127.0.0.1:3000")
    return $BaseUrl.TrimEnd('/')
}

# Charge un fichier .env dans des variables d'environnement (sans écraser).
function Import-EnvFile {
    param([string]$Path = (Join-Path (Get-Location) ".env"))
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $idx = $line.IndexOf('=')
            $key = $line.Substring(0, $idx).Trim()
            $val = $line.Substring($idx + 1).Trim()
            # retire les guillemets simples/doubles
            $val = $val.Trim('"', "'")
            if (-not [Environment]::GetEnvironmentVariable($key)) {
                [Environment]::SetEnvironmentVariable($key, $val)
            }
        }
    }
}

# ---------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------

function Invoke-Api {
    param(
        [string]$BaseUrl,
        [string]$Method = "GET",
        [string]$Path,
        [hashtable]$Headers = @{},
        [object]$Body
    )
    $uri = (Get-ApiBaseUrl $BaseUrl) + $Path
    $params = @{ Method = $Method; Uri = $uri; Headers = $Headers }
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    $res = Invoke-RestMethod @params
    return $res
}

# Version qui capture aussi le code de statut HTTP.
function Invoke-ApiStatus {
    param(
        [string]$BaseUrl,
        [string]$Method = "GET",
        [string]$Path,
        [hashtable]$Headers = @{},
        [object]$Body,
        [switch]$Raw
    )
    $uri = (Get-ApiBaseUrl $BaseUrl) + $Path
    $params = @{ Method = $Method; Uri = $uri; Headers = $Headers }
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    try {
        $res = Invoke-WebRequest @params -SkipHttpErrorCheck -ErrorAction Stop
        return [PSCustomObject]@{
            Status = [int]$res.StatusCode
            Body   = if ($res.Content) { $res.Content | ConvertFrom-Json } else { $null }
        }
    } catch {
        return [PSCustomObject]@{ Status = 0; Body = $_.Exception.Message }
    }
}

# ---------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------

$script:PassCount = 0
$script:FailCount = 0

function Assert-Equal {
    param([object]$Expected, [object]$Actual, [string]$Message)
    if ($Expected -eq $Actual) {
        $script:PassCount++
        Write-Host "  [PASS] $Message" -ForegroundColor Green
    } else {
        $script:FailCount++
        Write-Host "  [FAIL] $Message (attendu: $Expected, obtenu: $Actual)" -ForegroundColor Red
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if ($Condition) {
        $script:PassCount++
        Write-Host "  [PASS] $Message" -ForegroundColor Green
    } else {
        $script:FailCount++
        Write-Host "  [FAIL] $Message" -ForegroundColor Red
    }
}

function Assert-NotNull {
    param([object]$Value, [string]$Message)
    if ($null -ne $Value -and "$Value" -ne "") {
        $script:PassCount++
        Write-Host "  [PASS] $Message" -ForegroundColor Green
    } else {
        $script:FailCount++
        Write-Host "  [FAIL] $Message" -ForegroundColor Red
    }
}

function Show-TestSummary {
    Write-Host ""
    Write-Host "===== Résumé =====" -ForegroundColor Cyan
    Write-Host "  Pass: $script:PassCount  Fail: $script:FailCount" -ForegroundColor $(if ($script:FailCount -eq 0) { 'Green' } else { 'Red' })
    if ($script:FailCount -gt 0) { exit 1 }
}

# ---------------------------------------------------------------
# Auth & comptes (flow piYès)
# ---------------------------------------------------------------

# Crée un utilisateur unique et retourne { user, token, email, phone }.
function New-TestUser {
    param(
        [string]$BaseUrl,
        [string]$Prefix = "psmoncash"
    )
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $rand = Get-Random -Minimum 100000 -Maximum 999999
    $email = "${Prefix}.${ts}.${rand}@piyes.app"
    $phone = "+509" + (Get-Random -Minimum 30000000 -Maximum 99999999)

    $body = @{
        firstName = "PS"
        lastName  = "MonCash"
        name      = "PowerShell MonCash"
        email     = $email
        phone     = $phone
        password  = "Test1234!"
        device    = "powershell"
    }
    $res = Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/auth/signup" -Body $body
    return [PSCustomObject]@{
        User  = $res.user
        Token = $res.token
        Email = $email
        Phone = $phone
    }
}

function Set-TestPin {
    param([string]$BaseUrl, [string]$Token, [string]$Pin = "1234")
    return Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/user/pin" `
        -Headers @{ Authorization = "Bearer $Token" } `
        -Body @{ pin = $Pin }
}

# Lie un compte MonCash (banque b2) et retourne l'Account créé.
function Add-MonCashAccount {
    param([string]$BaseUrl, [string]$Token, [string]$Phone = "50937007294")
    $res = Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/banks/link" `
        -Headers @{ Authorization = "Bearer $Token" } `
        -Body @{ bankId = "b2"; username = $Phone }
    return $res
}

# Seed le solde ledger + User.balance directement via Supabase (service role).
# Équivalent PowerShell de fundUser() dans server/test/moncash.test.ts.
function Set-UserBalance {
    param(
        [string]$UserId,
        [string]$Name,
        [int]$Cents
    )
    Import-EnvFile
    $url = [Environment]::GetEnvironmentVariable("SUPABASE_URL")
    $key = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY")
    if (-not $url -or -not $key) {
        throw "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants pour Set-UserBalance"
    }
    $headers = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json" }

    # 1. RPC : crée le compte ledger si absent
    $rpcBody = @{
        p_customer_user_id      = $UserId
        p_name                  = $Name
        p_piyes_account_id      = $null
        p_piyes_user_id         = $UserId
        p_initial_balance_cents = $Cents
    } | ConvertTo-Json -Depth 5 -Compress
    $ledgerId = Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/piyes_ledger_get_or_create_customer_account" `
        -Headers $headers -Body $rpcBody

    # 2. upsert du solde ledger
    $balBody = @{ ledger_account_id = $ledgerId; balance_cents = $Cents } | ConvertTo-Json -Depth 5 -Compress
    $balHeaders = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json"; Prefer = "resolution=merge-duplicates" }
    Invoke-RestMethod -Method Post -Uri "$url/rest/v1/ledger_account_balance" -Headers $balHeaders -Body $balBody | Out-Null

    # 3. mise à jour du solde User
    $userBody = @{ balance = $Cents } | ConvertTo-Json -Depth 5 -Compress
    $userHeaders = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json"; Prefer = "return=minimal" }
    Invoke-RestMethod -Method Patch -Uri "$url/rest/v1/User?id=eq.$UserId" -Headers $userHeaders -Body $userBody | Out-Null

    return $ledgerId
}

# ---------------------------------------------------------------
# MonCash (service exposé par l'API)
# ---------------------------------------------------------------

function Get-MonCashPrefundedBalance {
    param([string]$BaseUrl, [string]$Token, [string]$AdminSecret)
    return Invoke-Api -BaseUrl $BaseUrl -Method "GET" -Path "/api/v1/transactions/moncash/prefunded-balance" `
        -Headers @{ Authorization = "Bearer $Token"; "x-admin-secret" = $AdminSecret }
}
