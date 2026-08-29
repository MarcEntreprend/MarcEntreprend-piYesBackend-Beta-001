# push-backend-env.ps1
param(
    [string]$EnvFile = ".\.env.vercel",
    [string]$Project = "piyesbackend001",
    [string]$Scope = "MarcEntreprend"
)

if (-not (Test-Path $EnvFile)) {
    Write-Error "Fichier $EnvFile introuvable"
    exit 1
}

vercel link --project=$Project --scope=$Scope 2>$null

$lines = Get-Content $EnvFile | Where-Object { $_ -match '^\s*[A-Z_]+=' }
foreach ($line in $lines) {
    if ($line -match '^\s*([A-Z_]+)=(.+?)\s*#type:(plain|encrypted)\s*$') {
        $key = $matches[1]
        $value = $matches[2].Trim()
        $type = $matches[3]
        
        Write-Host "Setting $key ($type)..." -NoNewline
        
        vercel env rm $key --project=$Project --scope=$Scope --yes 2>$null
        
        $cmd = "vercel env add $key $type production,preview,development --project=$Project --scope=$Scope"
        $result = Invoke-Expression -Command $cmd -ErrorAction SilentlyContinue
        if ($LASTEXITCODE -eq 0) { Write-Host " ✅" -ForegroundColor Green }
        else { Write-Host " ❌" -ForegroundColor Red; Write-Error $result }
    }
}
Write-Host "`n✅ Backend done. Redeploy sur Vercel."