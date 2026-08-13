<div align="center">
  <img width="800" height="317" alt="GHBanner" src="src/assets/images/logo-piyes-ppl-wh-wh-svg.svg" />
</div>

# piYes Wallet Backend

Production-grade Node.js / TypeScript backend for the piYes wallet.  
Supports P2P payments, QR flows, contacts, notifications, and an Open Banking (OBP) public API façade.

---

## Project Structure

```text
.
├── .vercel
├── docs
│   ├── DEVELOPER_GUIDE.md
│   └── MONCASH_INTEGRATION.md
├── node_modules
├── public
│   ├── android-chrome-192x192.png
│   ├── android-chrome-512x512.png
│   ├── apple-touch-icon.png
│   ├── favicon-16x16.png
│   ├── favicon-32x32.png
│   ├── favicon.ico
│   └── site.webmanifest
├── scripts
│   └── moncash
│       ├── helpers.ps1
│       ├── test-endpoints.ps1
│       └── test-flow.ps1
├── server
│   ├── src
│   │   ├── middleware
│   │   │   └── rateLimit.ts
│   │   ├── routes
│   │   │   ├── auth.ts
│   │   │   ├── banks.ts
│   │   │   ├── contacts.ts
│   │   │   ├── friendship.ts
│   │   │   ├── obpFacade.ts
│   │   │   ├── obpKeys.ts
│   │   │   ├── promotions.ts
│   │   │   ├── scheduler.ts
│   │   │   ├── services.ts
│   │   │   ├── swagger.ts
│   │   │   ├── transactions.ts
│   │   │   └── user.ts
│   │   ├── services
│   │   │   ├── apiKeyService.ts
│   │   │   ├── feeTransaction.ts
│   │   │   ├── ledgerService.ts
│   │   │   ├── moncashService.ts
│   │   │   ├── otpDeliveryService.ts
│   │   │   ├── otpService.ts
│   │   │   └── pinService.ts
│   │   ├── middleware.ts
│   │   └── supabase.ts
│   └── test
│       ├── auth.test.ts
│       ├── contacts.test.ts
│       ├── funds.test.ts
│       ├── helpers.ts
│       ├── moncash.test.ts
│       ├── obp.test.ts
│       ├── password.test.ts
│       ├── qr.test.ts
│       ├── scheduler.test.ts
│       ├── security.test.ts
│       └── transactions.test.ts
├── shared
│   ├── phoneFormatter.ts
│   ├── recipientUtils.ts
│   ├── schemas.ts
│   └── types.ts
├── src
│   └── assets
│       └── images
│           └── logo-piyes-ppl-wh-wh-svg.svg
├── .env
├── .env.example
├── .gitignore
├── notes.txt
├── obp-api-keys.sql
├── openapi.yaml
├── package-lock.json
├── package.json
├── README.md
├── server.ts
├── test-security.ps1
├── tsconfig.json
└── vercel.json
```

---

## Phases

### Phases 2 & 4 Integration

> **Branch**: `phase-1` → `phase-1to5`
> Phases 0, 1, 3, and 5 were already complete.
> This branch adds **Phase 2 (P2P)** and **Phase 4 (Public Open Banking API)**.

**Swagger UI**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

#### Phase 2 — P2P (QR, Advanced Contacts, Notifications)

| Endpoint                                   | Method | Description                                                              |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| `/api/v1/transactions/generate-qr`         | POST   | Generate a payment QR (`amount?`, `description?`, `expiresInMinutes?`)   |
| `/api/v1/transactions/scan-qr`             | POST   | Pay via scanned QR (alias of `/transactions/scan`, ledger + idempotency) |
| `/api/v1/contacts/suggestions`             | GET    | User suggestions (`?q=`, `?limit=`)                                      |
| `/api/v1/user/notifications/mark-all-read` | POST   | Mark all notifications as read                                           |
| `/api/v1/user/notifications/unread-count`  | GET    | Unread notification count                                                |

#### Phase 4 — Public Open Banking API (OBP v3.1.0)

- **Third-party API keys**: table `piyes_api_key` (see `obp-api-keys.sql`).
  Only the SHA-256 hash of the key is stored.
  - `POST /obp/v3.1.0/keys` (JWT admin) → creates a key (shown once)
  - `GET /obp/v3.1.0/keys`
  - `DELETE /obp/v3.1.0/keys/{id}`

- **Protected OBP endpoints** (require `X-API-Key` or `Bearer`):
  - `GET /obp/v3.1.0/banks`
  - `GET /obp/v3.1.0/accounts/public`
  - `GET /obp/v3.1.0/banks/{bankId}/accounts/{accountId}/{viewId}/transactions`

- **Two modes**:
  - **Proxy** → real OBP instance (when `OBP_BASE_URL` is set, uses DirectLogin)
  - **Mock** → read-only against Supabase (local development)

#### Files Added / Modified

| File                                   | Change                                                      |
| -------------------------------------- | ----------------------------------------------------------- |
| `server/src/routes/transactions.ts`    | `generate-qr`, `scan-qr`                                    |
| `server/src/routes/contacts.ts`        | `GET /suggestions`                                          |
| `server/src/routes/user.ts`            | `notifications/mark-all-read`, `notifications/unread-count` |
| `server/src/routes/obpFacade.ts`       | **New** — OBP v3.1.0 façade (proxy / mock)                  |
| `server/src/routes/obpKeys.ts`         | **New** — Third-party API key management                    |
| `server/src/services/apiKeyService.ts` | **New** — Hash / validation / middleware for API keys       |
| `obp-api-keys.sql`                     | **New** — Idempotent `piyes_api_key` table                  |
| `server.ts`                            | Mounts `/obp`                                               |
| `openapi.yaml`                         | P2P + OBP endpoints documented                              |
| `docs/DEVELOPER_GUIDE.md`              | Sections 6 & 8 updated                                      |

---

### Phase post-5-automatic-tests

**Où on en est après ce chantier :**

| Axe                                                      | Avant | Après | Commentaire                                                                                                                                                             |
| -------------------------------------------------------- | ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Couverture fonctionnelle                                 | 100 % | 100 % | inchangé                                                                                                                                                                |
| Fidélité à la spec OpenAPI                               | 100 % | 100 % | + `/auth/refresh`, code 429 documentés                                                                                                                                  |
| Sécurité (rate limit, helmet, sessions, OTP)             | ~35 % | 100 % | implémenté + testé runtime ET automatisé                                                                                                                                |
| Intégrations réelles (banques, MonCash, intl, OBP proxy) | ~50 % | ~50 % | inchangé (mocks assumés)                                                                                                                                                |
| Tests automatisés                                        | 0 %   | ~80 % | suite node:test + tsx, 51/51 verts --- auth, MFA, refresh, rate limit, OTP, OBP+proxy, transfer, idempotence, recharge/dépôt/retrait, contacts, scheduler, password, QR |
| Docs / guide développeur                                 | 90 %  | 95 %  | § Sécurité + § 12 Tests (51 tests) ajoutés                                                                                                                              |
| Verdict global                                           | ~70 % | ~92 % |                                                                                                                                                                         |

---

## Getting Started

### Prerequisites

- Node.js

### Installation

```bash
npm install
```

1. Run `obp-api-keys.sql` in the Supabase SQL Editor.
2. Start the development server:

   ```bash
   npm run dev
   ```

3. Type-check (must report 0 errors):

   ```bash
   npx tsc --noEmit
   ```

### Create an API Key & Call OBP Endpoints

```bash
# Create a key (admin JWT required)
curl -X POST http://localhost:3000/obp/v3.1.0/keys \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo"}'

# Call a protected endpoint
curl http://localhost:3000/obp/v3.1.0/banks \
  -H "X-API-Key: <apiKey>"
```

---

## Local Development

### TypeScript / TSX Error Check

```bash
npx tsc --noEmit
```

Or with a PowerShell helper:

```powershell
Write-Host "Vérification des erreurs TypeScript..." -ForegroundColor Cyan
npx tsc --noEmit

if ($LASTEXITCODE -eq 0) {
  Write-Host "✓ AUCUNE ERREUR !" -ForegroundColor Green
} else {
  Write-Host "✗ Des erreurs ont été trouvées" -ForegroundColor Red
}
```

### Quick Start (Windows)

```powershell
cd C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend
npm install
npm run dev
```

### Restart the Server

```bash
# Stop the running process (Ctrl+C), then:
npx tsx server.ts
```

**Swagger UI**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

### Clear Vite Cache

```powershell
Remove-Item -Recurse -Force node_modules/.vite -ErrorAction SilentlyContinue
```

---

## Comment lancer les Tests automatisés

### 1. Lancer le serveur (manuel)

```bash
npm install          # une fois (dépendances)
npm run dev          # ou : npm start
```

Le serveur tourne sur `http://localhost:3000` (port défini dans `server.ts`). Docs interactives Swagger : `http://localhost:3000/api-docs`.

Il faut un `.env` avec `DATABASE_URL` (Supabase) déjà en place. Sans `RESEND_API_KEY`/`TWILIO_*`, les codes OTP sont affichés en console (`[DEV] YOUR OTP IS: ...`).

### 2. Lancer les tests automatisés (24/24)

```bash
npm test
```

Chaque fichier démarre un vrai serveur sur son port dédié et joue les flux via HTTP. Résultat attendu :

```text
# tests 24
# pass 24
# fail 0
```

### 3. Voir le détail des tests

**Afficher le détail de chaque test (lignes `ok`/`not ok` + noms) :**

```bash
npm test 2>&1 | grep -E "^(ok|not ok)"
```

**Un seul fichier, pour voir un flux précis (ex. les transferts) :**

```bash
npx tsx --test server/test/transactions.test.ts
```

**Tests par domaine :**

- `auth.test.ts` — inscription, connexion, MFA/OTP, refresh (rotation + rejeu), logout-all
- `security.test.ts` — headers de sécurité, route debug supprimée, rate limit (429), OTP à usage unique
- `obp.test.ts` — clés API, endpoints publics Open Banking, révocation
- `transactions.test.ts` — transfert, idempotence, solde insuffisant, mauvais PIN, historique

**Détail verbeux (noms + durée) :**

```bash
npx tsx --test --test-reporter spec server/test/*.test.ts
```

**Test moncash terminal**

## Vérification manuelle

---

### 1\. Tester le token OAuth seul (curl)

```powershell
  $clientId = "4d1d47926758fa27c42175fe6d1780a8"
  $clientSecret = "3KTYedyQ6RL3w0TfJBnF_CejmX-7BkWJFyQLZ5bQVgmQzhcW2oKwb5PYI4Xrzk5d"
  $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${clientId}:${clientSecret}"))

  $body = "scope=read,write&grant_type=client_credentials"
  $headers = @{
      "Authorization" = "Basic $basic"
      "Content-Type" = "application/x-www-form-urlencoded"
  }

  $response = Invoke-RestMethod -Method POST -Uri "https://sandbox.moncashbutton.digicelgroup.com/Api/oauth/token" -Headers $headers -Body $body
  $response.access_token
  # Doit retourner un token (longue chaîne)
```

### 2\. Créer un paiement (sandbox)

```powershell
  $token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6WyJyZWFkLHdyaXRlIl0sImV4cCI6MTc4NjU5Nzc1NSwianRpIjoiZGI4NmM4ZTYtYzMwMi00OGRmLWExOTAtNmVkYzQ5NDg3MTJmIiwiY2xpZW50X2lkIjoiNGQxZDQ3OTI2NzU4ZmEyN2M0MjE3NWZlNmQxNzgwYTgifQ.hx0h2w5YkwbMWTptla3w6Z0oLvt21drN49OvgfMN33h3ZmvG-RKGAUwQ_64OizxkxmIbtg5WRDAY4xSSOekpHSCAY8DJ4mW4zYGz-nef4Zs2cXOYEybAdyrGJW4HQGNqY5f4-3VJ48s3d7bcff5MoJ6Z1Wzs86wGheGi_Mf0kZlRYjXAMYIPXoUFkslwKmz-dX3SxQbpr8xby0nBZvvmHBwkLJqslfWwiJw8pN35p1SLA_wGgpgeA8EhtyPL7WcYM61Ut7x6oZHlL2o-VHECENoIpCq2GT3ka2Gg027OF7x0146q_B6DqkRtOpUNm8Pus0Q09goziNYje88xLuzWXQ"
  $body = @{ amount = 100; orderId = "test-$(Get-Date -Format 'yyyyMMdd-HHmmss')" } | ConvertTo-Json
  $headers = @{
      "Authorization" = "Bearer $token"
      "Content-Type" = "application/json"
  }
  $response = Invoke-RestMethod -Method POST -Uri "https://sandbox.moncashbutton.digicelgroup.com/Api/v1/CreatePayment" -Headers $headers -Body $body
  $response.payment_token.token
  # Doit retourner un payment_token (ex: "abc123...")


3./ Option 2 : Utiliser le chemin absolu (si le script existe)

```

# Vérifier d'abord que le fichier existe

Test-Path scripts/moncash/test-flow.ps1

# Si oui, exécuter avec le chemin absolu

C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend\scripts\moncash\test-flow.ps1 -BaseUrl http://127.0.0.1:3000

````

### Prérequis / notes

- Il faut la base Supabase accessible (`DATABASE_URL`), sinon les tests échouent.
- Les tests utilisent l'OTP console (pas de Resend/Twilio) et polluent la base (`*.@piyes.app`, `payment_order`) — un cleanup SQL est possible entre deux runs si besoin.

---

## Deployment (Vercel)

```powershell
cd C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend

npm install
npm run build
vercel --prod
````

After a successful production deploy you should see:

```text
Production: https://piyesbackend001-xxxxx.vercel.app
```

You can then continue local development with:

```bash
npm run dev
```
