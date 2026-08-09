$base = "http://localhost:3000/api/v1"
$ErrorActionPreference = "Stop"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# ---------- 1. SIGNUP ----------
$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$email = "pw.test.$ts@piyes.app"
Write-Host "== Signup $email ==" -ForegroundColor Cyan
$signup = Invoke-RestMethod -Method Post -Uri "$base/auth/signup" `
  -ContentType "application/json" `
  -WebSession $session `
  -Body (@{ firstName="PW"; lastName="Test"; email=$email; password="Test1234!"; phone="+509$ts" } | ConvertTo-Json)
$token = $signup.token
Write-Host "  Signup OK, user id: $($signup.user.id)"

# ---------- 2. USER/SYNC (authMiddleware + session en base) ----------
Write-Host "== /user/sync ==" -ForegroundColor Cyan
$sync = Invoke-RestMethod -Method Get -Uri "$base/user/sync" `
  -Headers @{ Authorization = "Bearer $token" }
Write-Host "  Sync OK, balance: $($sync.user.balance)"

# ---------- 3. REFRESH (rotation) ----------
Write-Host "== /auth/refresh (1er appel) ==" -ForegroundColor Cyan
$r1 = Invoke-RestMethod -Method Post -Uri "$base/auth/refresh" -WebSession $session
Write-Host "  Refresh OK, nouveau token reçu"

# ---------- 4. REFRESH REPLAY (doit purger + 401) ----------
Write-Host "== /auth/refresh replay (doit echouer) ==" -ForegroundColor Cyan
try {
  Invoke-RestMethod -Method Post -Uri "$base/auth/refresh" -WebSession $session | Out-Null
  Write-Host "  ERREUR: le replay aurait du renvoyer 401"
} catch {
  Write-Host "  OK, replay rejete: $($_.Exception.Response.StatusCode.value__)"
}

# ---------- 5. LOGOUT-ALL puis acces bloque ----------
Write-Host "== logout-all puis /user/sync ==" -ForegroundColor Cyan
Invoke-RestMethod -Method Post -Uri "$base/auth/logout-all" `
  -Headers @{ Authorization = "Bearer $token" } -WebSession $session | Out-Null
try {
  Invoke-RestMethod -Method Get -Uri "$base/user/sync" `
    -Headers @{ Authorization = "Bearer $token" } | Out-Null
  Write-Host "  ERREUR: l'access token aurait du etre revoque"
} catch {
  Write-Host "  OK, acces bloque apres logout: $($_.Exception.Response.StatusCode.value__)"
}

# ---------- 6. OTP request + verify (code lu dans la console serveur) ----------
Write-Host "== OTP request/verify ==" -ForegroundColor Cyan
$otpEmail = "otp.test.$ts@piyes.app"
Invoke-RestMethod -Method Post -Uri "$base/auth/otp/request" `
  -ContentType "application/json" `
  -Body (@{ email=$otpEmail } | ConvertTo-Json) | Out-Null
Write-Host "  OTP demande. LIS LE CODE DANS LA CONSOLE SERVEUR, puis copie-le ci-dessous."
$code = Read-Host "Code OTP"
$verify = Invoke-RestMethod -Method Post -Uri "$base/auth/otp/verify" `
  -ContentType "application/json" `
  -Body (@{ email=$otpEmail; code=$code } | ConvertTo-Json)
Write-Host "  Verify OK: $($verify.success)"

Write-Host "`n=== Tous les tests passes ===" -ForegroundColor Green
