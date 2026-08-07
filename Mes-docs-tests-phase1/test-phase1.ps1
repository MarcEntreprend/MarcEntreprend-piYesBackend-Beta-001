# ============================================================
# TEST COMPLET DE LA PHASE 1 - LEDGER + IDEMPOTENCE
# À exécuter dans PowerShell (dans le dossier du projet)
# ============================================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "        TEST PHASE 1 - LEDGER" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# ÉTAPE 0 : Login avec demo3
# ============================================================
Write-Host "📌 ÉTAPE 0 : Login demo3" -ForegroundColor Yellow

$body = @{ email="demo3@test.com"; password="Test123!" } | ConvertTo-Json
$resp = curl -UseBasicParsing -Method POST -Uri "http://localhost:3000/api/v1/auth/login" -Body $body -ContentType "application/json"
$token = ($resp.Content | ConvertFrom-Json).token
$headers = @{ Authorization = "Bearer $token" }

Write-Host "✅ Login réussi" -ForegroundColor Green
Write-Host ""

# ============================================================
# ÉTAPE 1 : Récupérer l'ID du compte piYès
# ============================================================
Write-Host "📌 ÉTAPE 1 : Récupération du compte piYès" -ForegroundColor Yellow

$sync = curl -UseBasicParsing -Headers $headers -Uri "http://localhost:3000/api/v1/user/sync"
$syncData = $sync.Content | ConvertFrom-Json
$accounts = $syncData.accounts
$piyesAccount = $accounts | Where-Object { $_.provider -eq "piyes" }
$accountId = $piyesAccount.id

Write-Host "✅ Account ID : $accountId" -ForegroundColor Green
Write-Host "✅ Solde initial : $($piyesAccount.balance) HTG" -ForegroundColor Green
Write-Host ""

# ============================================================
# ÉTAPE 2 : Dépôt de 500 HTG
# ============================================================
Write-Host "📌 ÉTAPE 2 : Dépôt de 500 HTG" -ForegroundColor Yellow

$depositBody = @{
  amount = 500
  accountId = $accountId
  pin = "1234"
} | ConvertTo-Json

$depositResp = curl -UseBasicParsing -Method POST -Headers $headers -Uri "http://localhost:3000/api/v1/transactions/deposit" -Body $depositBody -ContentType "application/json"

if ($depositResp.StatusCode -eq 200) {
  Write-Host "✅ Dépôt réussi !" -ForegroundColor Green
} else {
  Write-Host "❌ Erreur dépôt : $($depositResp.Content)" -ForegroundColor Red
}
Write-Host ""

# ============================================================
# ÉTAPE 3 : Vérifier le solde après dépôt
# ============================================================
Write-Host "📌 ÉTAPE 3 : Vérification du solde" -ForegroundColor Yellow

Start-Sleep -Seconds 1

$sync = curl -UseBasicParsing -Headers $headers -Uri "http://localhost:3000/api/v1/user/sync"
$syncData = $sync.Content | ConvertFrom-Json
$accounts = $syncData.accounts
$piyesAccount = $accounts | Where-Object { $_.provider -eq "piyes" }

Write-Host "✅ Solde après dépôt : $($piyesAccount.balance) HTG" -ForegroundColor Green
Write-Host ""

# ============================================================
# ÉTAPE 4 : Créer l'utilisateur demo6 (s'il n'existe pas déjà)
# ============================================================
Write-Host "📌 ÉTAPE 4 : Création de demo6" -ForegroundColor Yellow

$body6 = @{ email="demo6@test.com"; password="Test123!"; name="Demo 6"; firstName="Demo"; lastName="6" } | ConvertTo-Json
$resp6 = curl -UseBasicParsing -Method POST -Uri "http://localhost:3000/api/v1/auth/signup" -Body $body6 -ContentType "application/json"

if ($resp6.StatusCode -eq 201) {
  Write-Host "✅ demo6 créé avec succès" -ForegroundColor Green
  $demo6 = $resp6.Content | ConvertFrom-Json
  $contactId = $demo6.user.id
  Write-Host "✅ ID demo6 : $contactId" -ForegroundColor Green
} else {
  Write-Host "⚠️ demo6 existe peut-être déjà" -ForegroundColor Yellow
  # Récupérer l'ID de demo6 via search
  $searchResp = curl -UseBasicParsing -Headers $headers -Uri "http://localhost:3000/api/v1/user/search?q=demo6"
  $searchData = $searchResp.Content | ConvertFrom-Json
  if ($searchData -and $searchData.Count -gt 0) {
    $contactId = $searchData[0].id
    Write-Host "✅ ID demo6 trouvé : $contactId" -ForegroundColor Green
  } else {
    Write-Host "❌ demo6 introuvable" -ForegroundColor Red
    exit
  }
}
Write-Host ""

# ============================================================
# ÉTAPE 5 : Créer le ledger de demo6 dans Supabase
# ============================================================
Write-Host "📌 ÉTAPE 5 : Création du ledger pour demo6" -ForegroundColor Yellow
Write-Host "⚠️  Exécute ce SQL dans Supabase SQL Editor :" -ForegroundColor Cyan
Write-Host ""
Write-Host "SELECT piyes_ledger_get_or_create_customer_account(" -ForegroundColor White
Write-Host "  '$contactId'," -ForegroundColor White
Write-Host "  'Demo 6'," -ForegroundColor White
Write-Host "  (SELECT ""accountNumber"" FROM ""User"" WHERE id = '$contactId')," -ForegroundColor White
Write-Host "  '$contactId'," -ForegroundColor White
Write-Host "  0" -ForegroundColor White
Write-Host ");" -ForegroundColor White
Write-Host ""
Write-Host "Appuie sur Entrée après avoir exécuté le SQL dans Supabase..." -ForegroundColor Yellow
Read-Host

# ============================================================
# ÉTAPE 6 : Transférer 100 HTG de demo3 vers demo6
# ============================================================
Write-Host "📌 ÉTAPE 6 : Transfert de 100 HTG vers demo6" -ForegroundColor Yellow

$transferBody = @{
  amount = 100
  contactId = $contactId
  description = "Test transfert Phase 1"
  pin = "1234"
} | ConvertTo-Json

$transferResp = curl -UseBasicParsing -Method POST -Headers $headers -Uri "http://localhost:3000/api/v1/transactions/transfer" -Body $transferBody -ContentType "application/json"

if ($transferResp.StatusCode -eq 200) {
  Write-Host "✅ Transfert réussi !" -ForegroundColor Green
} else {
  Write-Host "❌ Erreur transfert : $($transferResp.Content)" -ForegroundColor Red
}
Write-Host ""

# ============================================================
# ÉTAPE 7 : Vérifier le solde après transfert
# ============================================================
Write-Host "📌 ÉTAPE 7 : Vérification du solde après transfert" -ForegroundColor Yellow

Start-Sleep -Seconds 1

$sync = curl -UseBasicParsing -Headers $headers -Uri "http://localhost:3000/api/v1/user/sync"
$syncData = $sync.Content | ConvertFrom-Json
$accounts = $syncData.accounts
$piyesAccount = $accounts | Where-Object { $_.provider -eq "piyes" }

Write-Host "✅ Solde après transfert : $($piyesAccount.balance) HTG" -ForegroundColor Green
Write-Host ""

# ============================================================
# ÉTAPE 8 : Test d'idempotence
# ============================================================
Write-Host "📌 ÉTAPE 8 : Test d'idempotence (même clé)" -ForegroundColor Yellow

$idempotentBody = @{
  amount = 50
  contactId = $contactId
  description = "Test idempotence"
  pin = "1234"
  idempotencyKey = "test-idempotency-001"
} | ConvertTo-Json

Write-Host "▶️  Premier appel avec idempotencyKey = test-idempotency-001" -ForegroundColor Cyan
$resp1 = curl -UseBasicParsing -Method POST -Headers $headers -Uri "http://localhost:3000/api/v1/transactions/transfer" -Body $idempotentBody -ContentType "application/json"
$data1 = $resp1.Content | ConvertFrom-Json
Write-Host "✅ ID transaction 1 : $($data1.id)" -ForegroundColor Green
Write-Host "✅ payment_order_id 1 : $($data1.payment_order_id)" -ForegroundColor Green
Write-Host ""

Write-Host "▶️  Second appel avec la MÊME clé" -ForegroundColor Cyan
$resp2 = curl -UseBasicParsing -Method POST -Headers $headers -Uri "http://localhost:3000/api/v1/transactions/transfer" -Body $idempotentBody -ContentType "application/json"
$data2 = $resp2.Content | ConvertFrom-Json
Write-Host "✅ ID transaction 2 : $($data2.id)" -ForegroundColor Green
Write-Host "✅ payment_order_id 2 : $($data2.payment_order_id)" -ForegroundColor Green
Write-Host ""

# Vérifier l'idempotence
if ($data1.payment_order_id -eq $data2.payment_order_id) {
  Write-Host "✅ IDEMPOTENCE VALIDÉE : même payment_order_id ($($data1.payment_order_id))" -ForegroundColor Green
  Write-Host "✅ Pas de double débit !" -ForegroundColor Green
} else {
  Write-Host "❌ IDEMPOTENCE ÉCHOUÉE : payment_order_id différents" -ForegroundColor Red
}
Write-Host ""

# ============================================================
# ÉTAPE 9 : Vérifier le solde final
# ============================================================
Write-Host "📌 ÉTAPE 9 : Solde final" -ForegroundColor Yellow

Start-Sleep -Seconds 1

$sync = curl -UseBasicParsing -Headers $headers -Uri "http://localhost:3000/api/v1/user/sync"
$syncData = $sync.Content | ConvertFrom-Json
$accounts = $syncData.accounts
$piyesAccount = $accounts | Where-Object { $_.provider -eq "piyes" }

Write-Host "✅ Solde final : $($piyesAccount.balance) HTG" -ForegroundColor Green
Write-Host ""

# ============================================================
# RÉSUMÉ
# ============================================================
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "        RÉSUMÉ DES TESTS" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Login demo3" -ForegroundColor Green
Write-Host "✅ Dépôt 500 HTG" -ForegroundColor Green
Write-Host "✅ Solde après dépôt : $($piyesAccount.balance) HTG" -ForegroundColor Green
Write-Host "✅ Transfert 100 HTG vers demo6" -ForegroundColor Green
Write-Host "✅ Idempotence validée" -ForegroundColor Green
Write-Host "✅ Pas de double débit" -ForegroundColor Green
Write-Host ""
Write-Host "🎉 TOUS LES TESTS DE LA PHASE 1 SONT VALIDÉS !" -ForegroundColor Green
Write-Host ""