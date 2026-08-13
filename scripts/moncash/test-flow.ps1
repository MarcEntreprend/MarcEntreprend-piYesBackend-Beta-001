# scripts/moncash/test-flow.ps1
# Test de bout en bout de l'intégration MonCash.
#
# Prérequis :
#   1. Serveur démarré : npm run dev (ou npx tsx server.ts)
#   2. .env renseigné avec MONCASH_CLIENT_ID / MONCASH_CLIENT_SECRET
#      (real sandbox OU mock local pointé par MONCASH_API_HOST)
#   3. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY pour le seed de solde
#
# Usage :
#   powershell -File scripts/moncash/test-flow.ps1 [-BaseUrl http://127.0.0.1:3000]
#   powershell -File scripts/moncash/test-flow.ps1 -BaseUrl http://127.0.0.1:4023

param(
    [string]$BaseUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$scriptDir/helpers.ps1"

Import-EnvFile

Write-Host "===== Test MonCash E2E : $BaseUrl =====" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------
# 1. Signup + PIN + lien compte MonCash
# ---------------------------------------------------------------
Write-Host "[1] Setup utilisateur (signup, PIN, lien MonCash)" -ForegroundColor Yellow
$u = New-TestUser -BaseUrl $BaseUrl -Prefix "flow"
Assert-NotNull $u.Token "signup retourne un token"
Assert-NotNull $u.User.id "signup retourne un user.id"

Set-TestPin -BaseUrl $BaseUrl -Token $u.Token | Out-Null

$moncashPhone = if ($env:TEST_MONCASH_PHONE) { $env:TEST_MONCASH_PHONE } else { "50937007294" }
$link = Add-MonCashAccount -BaseUrl $BaseUrl -Token $u.Token -Phone $moncashPhone
Assert-NotNull $link.id "link crée un compte MonCash (id)"
Assert-Equal "moncash" $link.provider "provider == moncash"
Assert-Equal $moncashPhone $link.accountNumber "accountNumber == $moncashPhone"
$moncashAccountId = $link.id

# ---------------------------------------------------------------
# 2. Deposit MonCash → redirectUrl + orderId
# ---------------------------------------------------------------
Write-Host ""
Write-Host "[2] Deposit MonCash" -ForegroundColor Yellow
$dep = Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/deposit" `
    -Headers @{ Authorization = "Bearer $($u.Token)" } `
    -Body @{ amount = 10; accountId = $moncashAccountId; pin = "1234" }
Assert-NotNull $dep.redirectUrl "deposit retourne redirectUrl"
Assert-True ($dep.redirectUrl -match "/Payment/Redirect\?token=") "redirectUrl pointe vers le gateway MonCash"
Assert-NotNull $dep.paymentToken "deposit retourne paymentToken"
Assert-NotNull $dep.orderId "deposit retourne orderId"
$orderId = $dep.orderId

# ---------------------------------------------------------------
# 3. Confirm par orderId → ledger crédité
# ---------------------------------------------------------------
Write-Host ""
Write-Host "[3] Confirm par orderId" -ForegroundColor Yellow
$conf = Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/moncash/confirm" `
    -Headers @{ Authorization = "Bearer $($u.Token)" } `
    -Body @{ orderId = $orderId }
Assert-Equal "DEPOSIT" $conf.type "confirm.type == DEPOSIT"
Assert-Equal "COMPLETED" $conf.status "confirm.status == COMPLETED"
Assert-Equal 1000 $conf.amount "confirm.amount == 1000 (10 HTG en centimes)"
Assert-NotNull $conf.moncashReference "confirm.moncashReference présent"
Assert-NotNull $conf.payment_order_id "confirm.payment_order_id présent"

# Anti-rejeu : un 2e confirm renvoie la même transaction (pas de double dépôt)
Write-Host ""
Write-Host "[3b] Anti-rejeu (2e confirm renvoie la même Transaction)" -ForegroundColor Yellow
$conf2 = Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/moncash/confirm" `
    -Headers @{ Authorization = "Bearer $($u.Token)" } `
    -Body @{ orderId = $orderId }
Assert-Equal $conf.id $conf2.id "2e confirm renvoie la même transaction (id identique)"

# ---------------------------------------------------------------
# 4. Seed solde → Withdraw MonCash (payout réel)
# ---------------------------------------------------------------
Write-Host ""
Write-Host "[4] Withdraw MonCash (payout)" -ForegroundColor Yellow
try {
    Set-UserBalance -UserId $u.User.id -Name $u.User.name -Cents 10000 | Out-Null
    $wd = Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/withdraw" `
        -Headers @{ Authorization = "Bearer $($u.Token)" } `
        -Body @{ amount = 10; accountId = $moncashAccountId; pin = "1234" }
    Assert-Equal "WITHDRAW" $wd.type "withdraw.type == WITHDRAW"
    Assert-Equal "PAYER" $wd.role "withdraw.role == PAYER"
    Assert-Equal 1000 $wd.amount "withdraw.amount == 1000"
    Assert-NotNull $wd.moncashTransactionId "withdraw.moncashTransactionId présent"
    Assert-NotNull $wd.moncashReference "withdraw.moncashReference présent"
} catch {
    $script:FailCount++
    Write-Host "  [FAIL] withdraw MonCash : $($_.Exception.Message)" -ForegroundColor Red
}

# ---------------------------------------------------------------
# 5. Cas d'erreur : KYC inéligible, sans PIN
# ---------------------------------------------------------------
Write-Host ""
Write-Host "[5] Cas d'erreur (KYC inéligible / sans PIN)" -ForegroundColor Yellow

# 5a. Sans PIN → 400
$resNoPin = Invoke-ApiStatus -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/withdraw" `
    -Headers @{ Authorization = "Bearer $($u.Token)" } `
    -Body @{ amount = 10; accountId = $moncashAccountId }
Assert-Equal 400 $resNoPin.Status "withdraw sans PIN → 400"
Assert-True (("$($resNoPin.Body.error.message)" -match "PIN")) "message évoque le PIN"

# ---------------------------------------------------------------
# Résumé
# ---------------------------------------------------------------
Show-TestSummary
