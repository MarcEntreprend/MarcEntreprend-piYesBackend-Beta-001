# scripts/moncash/test-endpoints.ps1
# Test des endpoints annexes MonCash (en plus du flux principal) :
#   POST /api/v1/transactions/moncash/order-payment
#   POST /api/v1/transactions/moncash/transfer-status
#   GET  /api/v1/transactions/moncash/prefunded-balance   (admin secret)
#
# Prérequis :
#   1. Serveur démarré (npm run dev)
#   2. .env avec MONCASH_CLIENT_ID / MONCASH_CLIENT_SECRET
#   3. MONCASH_ADMIN_SECRET renseigné pour tester le 200 du prefunded-balance
#
# Usage :
#   powershell -File scripts/moncash/test-endpoints.ps1 [-BaseUrl http://127.0.0.1:3000]

param(
    [string]$BaseUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$scriptDir/helpers.ps1"

Import-EnvFile

Write-Host "===== Test endpoints MonCash : $BaseUrl =====" -ForegroundColor Cyan
Write-Host ""

$u = New-TestUser -BaseUrl $BaseUrl -Prefix "ep"
Assert-NotNull $u.Token "signup retourne un token"

# ---------------------------------------------------------------
# 1. order-payment
# ---------------------------------------------------------------
Write-Host "[1] POST /transactions/moncash/order-payment" -ForegroundColor Yellow
$op = Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/moncash/order-payment" `
    -Headers @{ Authorization = "Bearer $($u.Token)" } `
    -Body @{ orderId = "order-1" }
Assert-NotNull $op.payment "order-payment retourne un objet payment"
Assert-NotNull $op.payment.transaction_id "payment.transaction_id présent"

# orderId manquant → 400
$opErr = Invoke-ApiStatus -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/moncash/order-payment" `
    -Headers @{ Authorization = "Bearer $($u.Token)" } `
    -Body @{ }
Assert-Equal 400 $opErr.Status "order-payment sans orderId → 400"

# ---------------------------------------------------------------
# 2. transfer-status
# ---------------------------------------------------------------
Write-Host ""
Write-Host "[2] POST /transactions/moncash/transfer-status" -ForegroundColor Yellow
$ts = Invoke-Api -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/moncash/transfer-status" `
    -Headers @{ Authorization = "Bearer $($u.Token)" } `
    -Body @{ reference = "ref-abc-1" }
Assert-NotNull $ts.transStatus "transfer-status retourne transStatus"

# reference manquante → 400
$tsErr = Invoke-ApiStatus -BaseUrl $BaseUrl -Method "POST" -Path "/api/v1/transactions/moncash/transfer-status" `
    -Headers @{ Authorization = "Bearer $($u.Token)" } `
    -Body @{ }
Assert-Equal 400 $tsErr.Status "transfer-status sans reference → 400"

# ---------------------------------------------------------------
# 3. prefunded-balance (admin secret)
# ---------------------------------------------------------------
Write-Host ""
Write-Host "[3] GET /transactions/moncash/prefunded-balance" -ForegroundColor Yellow

# sans secret → 403
$balNoSecret = Invoke-ApiStatus -BaseUrl $BaseUrl -Method "GET" -Path "/api/v1/transactions/moncash/prefunded-balance" `
    -Headers @{ Authorization = "Bearer $($u.Token)" }
Assert-Equal 403 $balNoSecret.Status "prefunded-balance sans secret → 403"

# avec mauvais secret → 403
$balBad = Invoke-ApiStatus -BaseUrl $BaseUrl -Method "GET" -Path "/api/v1/transactions/moncash/prefunded-balance" `
    -Headers @{ Authorization = "Bearer $($u.Token)"; "x-admin-secret" = "wrong" }
Assert-Equal 403 $balBad.Status "prefunded-balance avec mauvais secret → 403"

# avec le bon secret → 200 + balance
$adminSecret = [Environment]::GetEnvironmentVariable("MONCASH_ADMIN_SECRET")
if ($adminSecret) {
    $balOk = Invoke-Api -BaseUrl $BaseUrl -Method "GET" -Path "/api/v1/transactions/moncash/prefunded-balance" `
        -Headers @{ Authorization = "Bearer $($u.Token)"; "x-admin-secret" = $adminSecret }
    Assert-NotNull $balOk.balance "prefunded-balance avec secret → balance présent"
    Assert-NotNull $balOk.message "balance.message présent"
} else {
    Write-Host "  [SKIP] MONCASH_ADMIN_SECRET non renseigné → test du 200 sauté" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------
# Résumé
# ---------------------------------------------------------------
Show-TestSummary
